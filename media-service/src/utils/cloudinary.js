const cloudinary = require("cloudinary").v2;
const logger = require("./logger");
const { trace, SpanStatusCode } = require("@opentelemetry/api");
const withTimeout = require("./withTimeout")
const {cloudinaryUploadDuration} = require("./metrics");

const tracer = trace.getTracer(process.env.SERVICE_NAME);

cloudinary.config({
  cloud_name: process.env.cloud_name,
  api_key: process.env.api_key,
  api_secret: process.env.api_secret,
});

const uploadMediaToCloudinary = (file) => {
  const CLOUDINARY_UPLOAD_TIMEOUT = Number(process.env.CLOUDINARY_UPLOAD_TIMEOUT) || 30000;

  return tracer.startActiveSpan(
    "Upload Media to Cloudinary",
    async (span) => {
      const timer = cloudinaryUploadDuration.startTimer({
        service: process.env.SERVICE_NAME,
        resource_type: "auto",
      });

      const start = Date.now();
      let uploadStream;
      try {
        //return new Promise((resolve, reject) => {
        const result = await withTimeout(new Promise((resolve, reject) => {
          //use uploader.upload to avoid callback and use promise-based api
          //const uploadStream = cloudinary.uploader.upload_stream(
          uploadStream = cloudinary.uploader.upload_stream(
            {
              resource_type: "auto",
            },
            (error, result) => {
              if (error) {
                logger.error("Error while uploading media to cloudinary", error);
                reject(error);
              } else {
                resolve(result);
              }
            }
          );

          uploadStream.on("error", reject);

          uploadStream.end(file.buffer);
        }), CLOUDINARY_UPLOAD_TIMEOUT, "Cloudinary upload", () => uploadStream.destroy());

        logger.info(`Cloudinary upload took ${Date.now() - start}ms`)

        span.setAttributes({
          "cloudinary.public_id": result.public_id,
          "cloudinary.resource_type": result.resource_type,
        });

        span.setStatus({
          code: SpanStatusCode.OK,
        });

        // cloudinaryUploadDuration.observe(
        //   {
        //     service: process.env.SERVICE_NAME,
        //     resource_type: result.resource_type,
        //     status: "success",
        //   },
        //   (Date.now() - start) / 1000
        // );
        timer({
          status: "success"
        })

        return result;
      } catch(err) {
          span.recordException(err);

          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err.message,
          });

          timer({
            status: "failed"
          })

          throw err;
        } finally {
          span.end();
        }
      }
  )
};

const deleteMediaFromCloudinary = async (publicId) => {
  return await tracer.startActiveSpan(
    "Delete Media from Cloudinary",
    async (span) => {
      try {
        const result = await withTimeout(cloudinary.uploader.destroy(publicId), 10000, "Cloudinary delete");
        //result: "ok or result: "not found"

        //Instead of treating "not found" as an error, treat it as success    
        if (
          result.result === "ok" ||
          result.result === "not found"
        ) {
          logger.info(
            `Cloudinary delete for ${publicId}: ${result.result}`
          );

          span.setAttributes({
            "cloudinary.public_id": publicId,
            "cloudinary.result": result.result,
          });

          span.setStatus({
            code: SpanStatusCode.OK,
          });

          return result.result;
        }

        throw new Error(
          `Unexpected Cloudinary response: ${result.result}`
        );
      } catch (err) {
        logger.error("Error deleting media from cloudinary", err);

        span.recordException(err);

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err.message,
        });

        throw err;
      } finally {
        span.end()
      }
    }
  )
};

module.exports = { uploadMediaToCloudinary, deleteMediaFromCloudinary };

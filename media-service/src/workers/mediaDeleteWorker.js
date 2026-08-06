const { Worker } = require("bullmq");
const { connection } = require("../config/bullmq");
const Media = require("../models/Media");
const logger = require("../utils/logger");
const { deleteMediaFromCloudinary } = require("../utils/cloudinary");
const {
  bullmqJobDuration,
  bullmqJobsProcessedTotal,
  bullmqJobsFailedTotal,
} = require("../utils/metrics");
const requestContext = require("../utils/requestContext");
const { propagation, context, trace, SpanStatusCode } = require("@opentelemetry/api");

const tracer = trace.getTracer(process.env.SERVICE_NAME);

const mediaDeleteWorker = new Worker(
  "media-delete",
  async (job) => {
    logger.info("traceHeaders in worker just b4 const parentContetx>>", job.data.traceHeaders);
    const parentContext = propagation.extract(
      context.active(),
      job.data.traceHeaders ?? {}
    );

    let end;

    return context.with(parentContext, async () => {
      return tracer.startActiveSpan(
        `Process ${job.name}`,
        async (span) => {
          try {
            end = bullmqJobDuration.startTimer({
              service: process.env.SERVICE_NAME,
              queue: job.queueName,
              job_name: job.name,
            });

            await requestContext.run(
              {
                correlationId: job.data.correlationId,
              },
              async () => {
                const { mediaId, publicId } = job.data;

                logger.info(`Processing media deletion job ${job.id}`);

                await deleteMediaFromCloudinary(publicId);

                await Media.deleteOne({
                  _id: mediaId,
                });

                logger.info(`Successfully deleted media ${job.data.mediaId}`);
              }
            );

            bullmqJobsProcessedTotal.inc({
              service: process.env.SERVICE_NAME,
              queue: job.queueName,
              job_name: job.name,
            });

            span.setAttributes({
              "job.id": job.id,
              "job.name": job.name,
              "media.id": job.data.mediaId,
              "cloudinary.public_id": job.data.publicId,
            });

            span.setStatus({
              code: SpanStatusCode.OK,
            });
          } catch (err) {
            bullmqJobsFailedTotal.inc({
              service: process.env.SERVICE_NAME,
              queue: job.queueName,
              job_name: job.name,
            });

            span.recordException(err);

            span.setStatus({
              code: SpanStatusCode.ERROR,
            });

            throw err; // BullMQ needs this to retry
          } finally {
            if (end) end();
            span.end();
          }
        }
      );
    });
  },
  {
    connection,
    concurrency: 10,
  }
);

mediaDeleteWorker.on("completed", (job) => {
  logger.info(`Job ${job.id} completed`);
});

mediaDeleteWorker.on("failed", (job, err) => {
  logger.error(
    `Job ${job?.id} failed after ${job?.attemptsMade} attempts`,
    err
  );
});

mediaDeleteWorker.on("error", (err) => {
  logger.error("BullMQ Worker error", err);
});

// process.on("SIGTERM", async () => {
//   logger.info("Closing BullMQ worker...");

//   await mediaDeleteWorker.close();

//   process.exit(0);
// });

// process.on("SIGINT", async () => {
//   logger.info("Closing BullMQ worker...");

//   await mediaDeleteWorker.close();
//   //Stops accepting new jobs, Waits for currently running jobs to finish, Releases Redis resources & Closes cleanly.

//   process.exit(0);
// });

module.exports = mediaDeleteWorker;
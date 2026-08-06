const { Worker } = require("bullmq");
const { connection } = require("../config/bullmq");
const logger = require("../utils/logger");
const { deleteMediaFromCloudinary } = require("../utils/cloudinary");

const mediaCleanupWorker = new Worker(
  "media-cleanup",
  async (job) => {
    await deleteMediaFromCloudinary(job.data.publicId);
    //logger.info(`cleanup job for ${job.data.publicId} compplete`)
  },
  {
    connection
  }
);

mediaCleanupWorker.on("completed", (job) => {
  logger.info(`Job ${job.name} ${job.jobId} completed`);
});

mediaCleanupWorker.on("failed", (job, err) => {
  logger.error(
    `Job ${job.name} ${job?.jobId} failed after ${job?.attemptsMade} attempts`,
    err
  );
});

mediaCleanupWorker.on("error", (err) => {
  logger.error("BullMQ Worker error", err);
});

module.exports = mediaCleanupWorker
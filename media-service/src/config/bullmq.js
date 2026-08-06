const { Queue } = require("bullmq");
const IORedis = require("ioredis");

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const mediaDeleteQueue = new Queue("media-delete", {
  connection,
});
const mediaCleanupQueue = new Queue("media-cleanup", {
  connection,
});

module.exports = {
  connection,
  mediaDeleteQueue,
  mediaCleanupQueue
};
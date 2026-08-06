const Redis = require("ioredis");

const redisClient = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,  //for bullmq

    connectTimeout: 10000,

    enableOfflineQueue: false,

    retryStrategy(times) {
        return Math.min(times * 1000, 10000);  //default = return Math.min(times * 50, 2000);
    },

    reconnectOnError(err) {
        return err.message.includes("READONLY"); // when using high-availability Redis (Redis Sentinel/ Cluster)
    },
});

module.exports = redisClient
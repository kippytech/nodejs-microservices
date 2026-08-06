const redis = require("../utils/redis");
const logger = require("../utils/logger");

const health = async (req, res) => {
  res.status(200).json({
    status: "UP",
    service: process.env.SERVICE_NAME,
    environment: process.env.NODE_ENV,
    //version: process.env.npm_package_version,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
};

const readiness = async (req, res) => {
  try {

    let redisReady = false;

    try {
      await redis.ping();
      redisReady = true;
    } catch {
      redisReady = false;
    }

    const ready = redisReady;

    res.status(ready ? 200 : 503).json({
      status: ready ? "READY" : "NOT_READY",

      service: process.env.SERVICE_NAME,
      environment: process.env.NODE_ENV,
      version: process.env.npm_package_version,
      uptime: process.uptime(),

      dependencies: {        
        redis: redisReady ? "UP" : "DOWN",
      },

      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("Readiness check failed.", err);

    res.status(503).json({
      status: "NOT_READY",
      service: process.env.SERVICE_NAME,
      environment: process.env.NODE_ENV,
      //version: process.env.npm_package_version,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }
};

module.exports = {
  health,
  readiness,
};
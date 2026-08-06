const mongoose = require("mongoose");
const { getRabbitMQChannel, isRabbitMQReady } = require("../utils/rabbitmq");
//const redis = require("../utils/redis");
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
    const mongo =
      mongoose.connection.readyState === 1;

    const rabbit = isRabbitMQReady() //!!getRabbitMQChannel();

    const ready =
      mongo && rabbit;

    res.status(ready ? 200 : 503).json({
      status: ready ? "READY" : "NOT_READY",

      service: process.env.SERVICE_NAME,
      environment: process.env.NODE_ENV,
      version: process.env.npm_package_version,
      uptime: process.uptime(),

      dependencies: {
        mongodb: mongo ? "UP" : "DOWN",
        rabbitmq: rabbit ? "UP" : "DOWN",
      },

      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(
      "Readiness check failed.",
      err
    );

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
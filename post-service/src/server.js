require("./tracing");
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const Redis = require("ioredis");
const cors = require("cors");
const helmet = require("helmet");
const postRoutes = require("./routes/post-routes");
const healthRoutes = require("./routes/health-routes");
const correlationId = require("./middleware/correlationId");
const errorHandler = require("./middleware/errorHandler");
const logger = require("./utils/logger");
const redisClient = require("./utils/redis");
const metricsMiddleware = require("./middleware/metrics");
const { register } = require("./utils/metrics");
const { connectToRabbitMQ, closeRabbitMQ } = require("./utils/rabbitmq");
const { processOutbox, cleanupPublishedEvents, stopOutboxWorker } = require("./workers/outbox-worker");
const retry = require("./utils/retry");

const app = express();
const PORT = process.env.PORT || 3002;

const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

//const redisClient = new Redis(process.env.REDIS_URL);

app.use(correlationId);
app.use(metricsMiddleware);

//middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/metrics", async (req, res) => {
  res.set(
    "Content-Type",
    register.contentType
  );

  res.end(await register.metrics());
});

app.use((req, res, next) => {
  logger.info(`Received ${req.method} request to ${req.url}`);
  logger.info("Request body>>", req.body);
  next();
});

//*** Homework - implement Ip based rate limiting for sensitive endpoints

//routes -> pass redisclient to routes
app.use(
  "/api/posts",
  (req, res, next) => {
    req.redisClient = redisClient;
    next();
  },
  postRoutes
);

app.use("/api", healthRoutes);

app.use(errorHandler);

async function connectMongo() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
    });

    logger.info("Connected to MongoDB.");
  } catch (err) {
    logger.error("Mongo connection error", err);
    throw err;
  }
}

async function connectRedis() {
    await redisClient.ping();

    logger.info("Connected to Redis");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry() {
    const RETRY_DELAY = 5000;

    while (true) {
        try {
            //await connectMongo();
            await retry(connectMongo, "MongoDB");

            await retry(connectRedis, "Redis");

            await connectToRabbitMQ();

            logger.info("Connected to RabbitMQ.");

            return;
        } catch (err) {
            logger.warn(
                `RabbitMQ unavailable. Retrying in ${RETRY_DELAY / 1000}s...`
            );

            await sleep(RETRY_DELAY);
        }
    }
}

let cleanupInterval
let outboxWorkerPromise;
let server;
async function startServer() {
  try {
    //await connectToRabbitMQ();
    await connectWithRetry()

    // Start the worker ONCE and keep its Promise
    outboxWorkerPromise = processOutbox();

    await cleanupPublishedEvents();  //run once b4 the setInterval

    cleanupInterval = setInterval(async () => {
      try {
        await cleanupPublishedEvents();
      } catch (err) {
        logger.error(
          "Failed to clean published outbox events",
          err
        );
      }
    }, CLEANUP_INTERVAL);
    
    server = app.listen(PORT, () => {
      logger.info(`Post service running on port ${PORT}`);
    });

    // Maximum time allowed for the entire request
    server.requestTimeout = 30_000;

    // Maximum time allowed to receive HTTP headers
    server.headersTimeout = 35_000;

    // Keep-alive timeout for idle connections
    server.keepAliveTimeout = 5_000;

    // Time waiting for additional data after keep-alive
    server.timeout = 30_000;
  } catch (error) {
    logger.error("Failed to connect to server", error);
    process.exit(1);
  }
}

async function shutdown(signal) {
  logger.info(`${signal} received. Shutting down...`);

  const FORCE_EXIT_TIMEOUT = 10000;

  const timeout = setTimeout(() => {
    logger.error("Graceful shutdown timed out. Forcing exit.");

    process.exit(1);
  }, FORCE_EXIT_TIMEOUT);

  timeout.unref();

  try {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) return reject(err);

        logger.info("HTTP server closed.");

        resolve();
      });
    });

    stopOutboxWorker()

    await outboxWorkerPromise;

    clearInterval(cleanupInterval);

    await mongoose.connection.close();

    await redisClient.quit();

    await closeRabbitMQ();

    logger.info("Shutdown complete.");

    process.exitCode = 0;
  } catch (err) {
    logger.error("Shutdown failed.", err);

    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

process.once("SIGINT", () => shutdown("SIGINT"));

process.once("SIGTERM", () => shutdown("SIGTERM"));

//unhandled promise rejection
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error) {
    logger.error("Unhandled Rejection", {
      message: reason.message,
      stack: reason.stack,
    });
  } else {
    logger.error("Unhandled Rejection", {
      reason,
    });
  }
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception", {
    message: err.message,
    stack: err.stack,
  });

  process.exit(1);
});

startServer();

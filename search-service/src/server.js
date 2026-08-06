require("./tracing");
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const redisClient = require("./utils/redis");
const cors = require("cors");
const helmet = require("helmet");
const errorHandler = require("./middleware/errorHandler");
const correlationId = require("./middleware/correlationId");
const metricsMiddleware = require("./middleware/metrics");
const logger = require("./utils/logger");
const { register } = require("./utils/metrics");
//const { connectToRabbitMQ, consumeEvent } = require("./utils/rabbitmq");
const {
  connectToRabbitMQ,
  bindEvent,
  startConsumer,
  closeRabbitMQ
} = require("./utils/rabbitmq");
const searchRoutes = require("./routes/search-routes");
const healthRoutes = require("./routes/health-routes");
const {
  handlePostCreated,
  handlePostDeleted,
} = require("./eventHandlers/search-event-handlers");
const retry = require("./utils/retry");

const app = express();
const PORT = process.env.PORT || 3004;

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
  logger.info(`Request body, ${JSON.stringify(req.body)}`);
  next();
});

//*** Homework - implement Ip based rate limiting for sensitive endpoints

//*** Homework - pass redis client as part of your req and then implement redis caching
app.use("/api/search", searchRoutes);

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

let server;
async function startServer() {
  try {
    //await connectMongo()
    await retry(connectMongo, "MongoDB");

    await retry(connectRedis, "Redis");
    //await connectToRabbitMQ();
    await connectWithRetry()

    // // NOT GOOD Because RabbitMQ distributes messages among consumers on the same queue.
    // // The routing key is already forgotten by the time the message reaches the queue.
    // //The binding decided which queue receives the message—not which consumer on that queue receives it
    //The consumers commented out below assume they'll only ever receive the event type they were "registered" for—but RabbitMQ doesn't make that guarantee for consumers on the same queue.
    // await consumeEvent("post.created", handlePostCreated);
    // await consumeEvent("post.deleted", handlePostDeleted);

    await bindEvent("post.created");
    await bindEvent("post.deleted");

    await startConsumer({
      "post.created": handlePostCreated,
      "post.deleted": handlePostDeleted,
    });

    server = app.listen(PORT, () => {
      logger.info(`Search service is running on port: ${PORT}`);
    });

    // Maximum time allowed for the entire request
    server.requestTimeout = 30_000;

    // Maximum time allowed to receive HTTP headers
    server.headersTimeout = 35_000;

    // Keep-alive timeout for idle connections
    server.keepAliveTimeout = 5_000;

    // Time waiting for additional data after keep-alive
    server.timeout = 30_000;
  } catch (e) {
    logger.error(e, "Failed to start search service");
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

process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error) {
    logger.error("Unhandled Rejection", {
      message: reason.message,
      stack: reason.stack,
    });
  } else {
    logger.error("Unhandled Rejection", { reason });
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

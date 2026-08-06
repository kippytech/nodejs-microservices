require("./tracing");
require("dotenv").config();
const mongoose = require("mongoose");
const logger = require("./utils/logger");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { RateLimiterRedis } = require("rate-limiter-flexible");
//const Redis = require("ioredis");
const redisClient = require("./redis")
const { rateLimit } = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const routes = require("./routes/identity-service");
const healthRoutes = require("./routes/health-routes");
const errorHandler = require("./middleware/errorHandler");
const correlationId = require("./middleware/correlationId");
const metricsMiddleware = require("./middleware/metrics");
const { register } = require("./utils/metrics");
const retry = require("./utils/retry");

const app = express();
const PORT = process.env.PORT || 3001;

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

// Global rate limiting / basic DoS protection
// const rateLimiter = new RateLimiterRedis({
//   storeClient: redisClient,
//   keyPrefix: "middleware",
//   points: 10,
//   duration: 1, //10 req/second
// });

// app.use((req, res, next) => {
//   rateLimiter
//     .consume(req.ip)
//     .then(() => next())
//     .catch(() => {
//       logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
//       res.status(429).json({ success: false, message: "Too many requests" });
//     });
// });

// // Global API rate limiting (10 requests per second per IP)
// const globalRateLimiter = rateLimit({
//   windowMs: 1000, // 1 second
//   limit: 10,

//   standardHeaders: true,
//   legacyHeaders: false,

//   store: new RedisStore({
//     sendCommand: (...args) => redisClient.call(...args),
//   }),

//   handler: (req, res) => {
//     logger.warn(`Global rate limit exceeded for IP: ${req.ip}`);

//     res.status(429).json({
//       success: false,
//       message: "Too many requests. Please try again later.",
//     });
//   },
// });

// // Apply to all HTTP routes
// app.use(globalRateLimiter);

// Simple IP rate limiting for auth routes ---> rate-flexible is actually better 
// const sensitiveEndpointsLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 5,
//   standardHeaders: true,
//   legacyHeaders: false,
//   handler: (req, res) => {
//     logger.warn(`Sensitive endpoint rate limit exceeded for IP: ${req.ip}`);
//     res.status(429).json({ success: false, message: "Too many requests" });
//   },
//   store: new RedisStore({
//     sendCommand: (...args) => redisClient.call(...args),
//   }),
// });

// better than the express one above for sensitive endpoints --> taken to controllers
// const loginLimiter = new RateLimiterRedis({
//   storeClient: redisClient,
//   keyPrefix: "login",
//   points: 50,
//   duration: 15 * 60,
//   blockDuration: 30 * 60,
// });

// app.post("/api/auth/login", async (req, res, next) => {
  // try {
  //   await loginLimiter.consume(req.ip);
  // } catch (err) {
  //   if (err instanceof RateLimiterRes) {
  //     return res.status(429).json({
  //       success: false,
  //       message: "Too many login attempts",
  //     });
  //   }

  //   logger.error(err);

  //   return res.status(500).json({
  //     success: false,
  //     message: "Internal server error",
  //   });
  // }

//apply this sensitiveEndpointsLimiter to our routes
//app.use("/api/auth/register", sensitiveEndpointsLimiter);

//Routes
app.use("/api/auth", routes);

app.use("/api", healthRoutes);

//error handler
app.use(errorHandler);

async function connectMongo() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000, //How long to wait for MongoDB to be discovered -> default=30s
      socketTimeoutMS: 45000,  //TCP connection timeout
      connectTimeoutMS: 10000,  //Maximum inactivity before Mongo closes the socket
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

// app.listen(PORT, () => {
//   logger.info(`Identity service running on port ${PORT}`);
// });
let server;
async function startServer() {
    //await connectMongo()
    await retry(connectMongo, "MongoDB");

    await retry(connectRedis, "Redis");
    
    server = app.listen(PORT, () => {
        logger.info(`Identity service running on port ${PORT}`);
    });

    // Maximum time allowed for the entire request
    server.requestTimeout = 30_000;

    // Maximum time allowed to receive HTTP headers
    server.headersTimeout = 35_000;

    // Keep-alive timeout for idle connections
    server.keepAliveTimeout = 5_000;

    // Time waiting for additional data after keep-alive
    server.timeout = 30_000;
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

startServer()

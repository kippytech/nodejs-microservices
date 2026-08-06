require("./tracing");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
//const Redis = require("ioredis");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const logger = require("./utils/logger");
const proxy = require("express-http-proxy");
const errorHandler = require("./middleware/errorhandler");
const { validateToken } = require("./middleware/authMiddleware");
const correlationId = require("./middleware/correlationId");
const metricsMiddleware = require("./middleware/metrics");
const { register } = require("./utils/metrics");
const healthRoutes = require("./routes/health-routes");
const redisClient = require("./utils/redis");
const retry = require("./utils/retry");

const app = express();
const PORT = process.env.PORT || 3000;

//const redisClient = new Redis(process.env.REDIS_URL);

app.use(correlationId);
app.use(metricsMiddleware);

app.use(helmet());
app.use(cors());
//app.use(express.json());

app.get("/metrics", async (req, res) => {
  res.set(
    "Content-Type",
    register.contentType
  );

  res.end(await register.metrics());
});

app.use("/api", healthRoutes);

//rate limiting
const ratelimitOptions = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Sensitive endpoint rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({ success: false, message: "Too many requests" });
  },
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
  }),
});

//app.use(ratelimitOptions);
app.use((req, res, next) => {
    if (
        req.path === "/api/health" ||
        req.path === "/api/readiness"
    ) {
        return next();
    }

    return ratelimitOptions(req, res, next);
});

app.use((req, res, next) => {
  logger.info({
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userId: req.user?.userId,
  });

  next();
});

const proxyOptions = {
  proxyReqPathResolver: (req) => {
    return req.originalUrl.replace(/^\/v1/, "/api");
  },
  proxyErrorHandler: (err, res, next) => {
    logger.error(`Proxy error: ${err.message}`);
    res.status(500).json({
      message: `Internal server error`,
      error: err.message,
    });
  },
};

//setting up proxy for our identity service
app.use(
  "/v1/auth",
  proxy(process.env.IDENTITY_SERVICE_URL, {
    ...proxyOptions,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers["Content-Type"] = "application/json";
      proxyReqOpts.headers["x-correlation-id"] = srcReq.headers["x-correlation-id"];
      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      logger.info(
        `Response received from Identity service: ${proxyRes.statusCode}`
      );

      return proxyResData;
    },
  })
);

// import { createProxyMiddleware } from "http-proxy-middleware";

// app.use(
//   "/v1/auth",
//   createProxyMiddleware({
//     target: process.env.IDENTITY_SERVICE_URL,
//     changeOrigin: true,

//     pathRewrite: (path) => path.replace(/^\/v1/, "/api"),

//     on: {
//       proxyReq(proxyReq) {
//         proxyReq.setHeader("Content-Type", "application/json");
//         proxyReq.setHeader("x-correlation-id", req.headers["x-correlation-id"]);
//       },

//       proxyRes(proxyRes, req, res) {
//         logger.info(
//           `Response received from Identity service: ${proxyRes.statusCode}`
//         );
//       },

//       error(err, req, res) {
//         logger.error(`Proxy error: ${err.message}`);

//         res.status(500).json({
//           message: "Internal server error",
//           error: err.message,
//         });
//       },
//     },
//   })
// );

//setting up proxy for our post service
app.use(
  "/v1/posts",
  validateToken,
  proxy(process.env.POST_SERVICE_URL, {
    ...proxyOptions,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers["Content-Type"] = "application/json";
      //delete proxyReqOpts.headers["x-user-id"];
      proxyReqOpts.headers["x-user-id"] = srcReq.user.userId;
      proxyReqOpts.headers["x-correlation-id"] = srcReq.headers["x-correlation-id"]; //requestContext.getStore()?.correlationId;

      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      logger.info(
        `Response received from Post service: ${proxyRes.statusCode}`
      );

      return proxyResData;
    },
  })
);

// import { createProxyMiddleware } from "http-proxy-middleware";

// app.use(
//   "/v1/posts",
//   validateToken,
//   createProxyMiddleware({
//     target: process.env.POST_SERVICE_URL,
//     changeOrigin: true,

//     pathRewrite: (path) => path.replace(/^\/v1/, "/api"),

//     on: {
//       proxyReq(proxyReq, req) {
//         proxyReq.setHeader("Content-Type", "application/json");
//         proxyReq.setHeader("x-user-id", req.user.userId);
//         proxyReq.setHeader("x-correlation-id", req.headers["x-correlation-id"]);
//       },

//       proxyRes(proxyRes) {
//         logger.info(
//           `Response received from Post service: ${proxyRes.statusCode}`
//         );
//       },

//       error(err, req, res) {
//         logger.error(`Proxy error: ${err.message}`);

//         res.status(500).json({
//           message: "Internal server error",
//           error: err.message,
//         });
//       },
//     },
//   })
// );

//setting up proxy for our media service
app.use(
  "/v1/media",
  validateToken,
  proxy(process.env.MEDIA_SERVICE_URL, {
    ...proxyOptions,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers["x-user-id"] = srcReq.user.userId;
      proxyReqOpts.headers["x-correlation-id"] = srcReq.headers["x-correlation-id"];
      if (!srcReq.headers["content-type"]?.startsWith("multipart/form-data")) {
        proxyReqOpts.headers["Content-Type"] = "application/json";
      }

      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      logger.info(
        `Response received from media service: ${proxyRes.statusCode}`
      );

      return proxyResData;
    },
    parseReqBody: false,
  })
);

// import { createProxyMiddleware } from "http-proxy-middleware";

// app.use(
//   "/v1/media",
//   validateToken,
//   createProxyMiddleware({
//     target: process.env.MEDIA_SERVICE_URL,
//     changeOrigin: true,

//     pathRewrite: (path) => path.replace(/^\/v1/, "/api"),

//     on: {
//       proxyReq(proxyReq, req) {
//         proxyReq.setHeader("x-user-id", req.user.userId);
//         proxyReq.setHeader("x-correlation-id", req.headers["x-correlation-id"]);

//         if (!req.headers["content-type"]?.startsWith("multipart/form-data")) {
//           proxyReq.setHeader("Content-Type", "application/json");
//         }
//       },

//       proxyRes(proxyRes) {
//         logger.info(
//           `Response received from media service: ${proxyRes.statusCode}`
//         );
//       },

//       error(err, req, res) {
//         logger.error(`Proxy error: ${err.message}`);

//         res.status(500).json({
//           message: "Internal server error",
//           error: err.message,
//         });
//       },
//     },
//   })
// );

//setting up proxy for our search service
app.use(
  "/v1/search",
  validateToken,
  proxy(process.env.SEARCH_SERVICE_URL, {
    ...proxyOptions,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers["Content-Type"] = "application/json";
      proxyReqOpts.headers["x-user-id"] = srcReq.user.userId;
      proxyReqOpts.headers["x-correlation-id"] = srcReq.headers["x-correlation-id"];

      return proxyReqOpts;
    },
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
      logger.info(
        `Response received from Search service: ${proxyRes.statusCode}`
      );

      return proxyResData;
    },
  })
);

// import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";

// app.use(
//   "/v1/search",
//   validateToken,
//   createProxyMiddleware({
//     target: process.env.SEARCH_SERVICE_URL,
//     changeOrigin: true,

//     pathRewrite: (path) => path.replace(/^\/v1/, "/api"),

//     on: {
//       proxyReq(proxyReq, req) {
//         //fixRequestBody(proxyReq, req); // needed if we keep app.use(req.json())
//         proxyReq.setHeader("Content-Type", "application/json");
//         proxyReq.setHeader("x-user-id", req.user.userId);
//         proxyReq.setHeader("x-correlation-id", req.headers["x-correlation-id"]);
//       },

//       proxyRes(proxyRes) {
//         logger.info(
//           `Response received from Search service: ${proxyRes.statusCode}`
//         );
//       },

//       error(err, req, res) {
//         logger.error(`Proxy error: ${err.message}`);

//         res.status(500).json({
//           message: "Internal server error",
//           error: err.message,
//         });
//       },
//     },
//   })
// );

app.use(errorHandler);

async function connectRedis() {
    await redisClient.ping();

    logger.info("Connected to Redis");
}

let server;
async function startServer() {
    await retry(connectRedis, "Redis");
    
    app.listen(PORT, () => {
      logger.info(`API Gateway is running on port ${PORT}`);
      logger.info(
        `Identity service is running on port ${process.env.IDENTITY_SERVICE_URL}`
      );
      logger.info(
        `Post service is running on port ${process.env.POST_SERVICE_URL}`
      );
      logger.info(
        `Media service is running on port ${process.env.MEDIA_SERVICE_URL}`
      );
      logger.info(
        `Search service is running on port ${process.env.SEARCH_SERVICE_URL}`
      );
      logger.info(`Redis Url ${process.env.REDIS_URL}`);
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

    //await mongoose.connection.close();

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

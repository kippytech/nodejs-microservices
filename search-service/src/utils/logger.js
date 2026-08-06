// const winston = require("winston");

// const logger = winston.createLogger({
//   level: process.env.NODE_ENV === "production" ? "info" : "debug",
//   format: winston.format.combine(
//     winston.format.timestamp(),
//     winston.format.errors({ stack: true }),
//     winston.format.splat(),
//     winston.format.json()
//   ),
//   defaultMeta: { service: "post-service" },
//   transports: [
//     new winston.transports.Console({
//       format: winston.format.combine(
//         winston.format.colorize(),
//         winston.format.simple()
//       ),
//     }),
//     new winston.transports.File({ filename: "error.log", level: "error" }),
//     new winston.transports.File({ filename: "combined.log" }),
//   ],
// });

// module.exports = logger;


// WITH DOCKER

const winston = require("winston");
const requestContext = require("./requestContext");
const { trace } = require("@opentelemetry/api");
const util = require("node:util");

const isProduction = process.env.NODE_ENV === "production";

const injectTracing = winston.format((info) => {
  const store = requestContext.getStore();

  info.service = process.env.SERVICE_NAME;
  info.correlationId = store?.correlationId ?? "unknown";

  const span = trace.getActiveSpan();

  if (span) {
    const spanContext = span.spanContext();

    info.traceId = spanContext.traceId;
    info.spanId = spanContext.spanId;
  } else {
    info.traceId = "unknown";
    info.spanId = "unknown";
  }

  return info;
});

const logger = winston.createLogger({
  level: isProduction ? "info" : "debug",

  defaultMeta: {
    service: process.env.SERVICE_NAME,
  },

  format: isProduction
    ? winston.format.combine(
        injectTracing(),
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
      )
    : winston.format.combine(
        injectTracing(),
        winston.format.colorize(),
        winston.format.timestamp({
          format: "HH:mm:ss",
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.printf(
          ({ timestamp, level, message, stack, ...meta }) => {
            const renderedMessage =
              typeof message === "string"
                ? message
                : util.inspect(message, {
                    depth: null,
                    colors: true,
                  });

            let log = `${timestamp} ${level}: ${stack || renderedMessage}`;

            if (Object.keys(meta).length) {
              //log += ` ${JSON.stringify(meta)}`;
              log += ` ${util.inspect(meta, {
                depth: null,
                colors: true,
              })}`
            }

            return log;
          }
        )
      ),

  transports: [new winston.transports.Console()],
});

module.exports = logger;
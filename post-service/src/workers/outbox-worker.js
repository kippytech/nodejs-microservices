const OutboxEvent = require("../models/OutboxEvent");
const { publishEvent } = require("../utils/rabbitmq");
const logger = require("../utils/logger");
const {
  outboxPublishedTotal,
  outboxPublishFailuresTotal,
  outboxPublishDuration,
} = require("../utils/metrics");
const { trace, SpanStatusCode, propagation, context, ROOT_CONTEXT } = require("@opentelemetry/api");
const requestContext = require("../utils/requestContext");

const tracer = trace.getTracer(process.env.SERVICE_NAME);

const POLL_INTERVAL = 1000;
const PROCESSING_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const MAX_OUTBOX_ATTEMPTS = 10;
const RETENTION_DAYS = 7;
//const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
let isRunning = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recoverStaleProcessingEvents() {
  const cutoff = new Date(
    Date.now() - PROCESSING_TIMEOUT
  );

  const result = await OutboxEvent.updateMany(
    {
      status: "PROCESSING",
      processingStartedAt: {
        $lt: cutoff,
      },
    },
    {
      $set: {
        status: "PENDING",
      },
      $unset: {
        processingStartedAt: "",
      },
    }
  );

  if (result.modifiedCount > 0) {
    logger.warn(
      `Recovered ${result.modifiedCount} stale outbox event(s).`
    );
  }
}

async function processOutbox() {
  isRunning = true;

  while (true) {
        try {
          //If Worker crashes, it prevents status stuck Forever at PROCESSING
          await recoverStaleProcessingEvents();

          // Atomically claim ONE pending event
          const outboxEvent = await OutboxEvent.findOneAndUpdate(
            {
              status: "PENDING",
            },
            {
              status: "PROCESSING",
              processingStartedAt: new Date(),
              $inc: { attempts: 1 }
            },
            {
              sort: { createdAt: 1 },
              new: true,
            }
          );

          // Nothing to do
          if (!outboxEvent) {
            await sleep(POLL_INTERVAL);
            continue;
          }

          console.log("ROOT_CONTEXT =", ROOT_CONTEXT);
          console.log("traceHeaders =", outboxEvent.traceHeaders);

          const parentContext = propagation.extract(
            ROOT_CONTEXT,  //active(),
            outboxEvent.traceHeaders ?? {}
          );
      
          await context.with(parentContext, async () => {

          await requestContext.run(
            {
              correlationId: outboxEvent.correlationId,
            },
            async () => {
                await tracer.startActiveSpan(
                `Publish ${outboxEvent.eventType}`,
                async (span) => {
                  let end;
                  try {
                    end = outboxPublishDuration.startTimer({
                      service: process.env.SERVICE_NAME,
                      event_type: outboxEvent.eventType,
                    });

                    logger.info({
                      rawCarrier: outboxEvent.traceHeaders,
                      keys: Object.keys(outboxEvent.traceHeaders),
                    });

                    // Publish to RabbitMQ
                    await publishEvent(outboxEvent.eventType, {
                      eventId: outboxEvent.eventId,
                      eventType: outboxEvent.eventType,
                      occurredAt: outboxEvent.occurredAt,

                      ...outboxEvent.payload,
                    },
                    {
                      "x-correlation-id": outboxEvent.correlationId,
                      ...outboxEvent.traceHeaders,          
                    }
                  );

                    outboxPublishedTotal.inc({
                      service: process.env.SERVICE_NAME,
                      event_type: outboxEvent.eventType,
                    });

                    end();

                    // Mark as published
                    outboxEvent.status = "PUBLISHED";
                    outboxEvent.publishedAt = new Date();

                    await outboxEvent.save();

                    span.setAttributes({
                      "messaging.system": "rabbitmq",
                      "messaging.destination": outboxEvent.eventType,
                      "event.id": outboxEvent.eventId,
                    });

                    span.setStatus({
                      code: SpanStatusCode.OK,
                    });

                    logger.info(
                      `Published outbox event ${outboxEvent.eventId}`
                    );
                  } catch (err) {
                      span.recordException(err);

                      span.setStatus({
                        code: SpanStatusCode.ERROR,
                      });

                      outboxPublishFailuresTotal.inc({
                        service: process.env.SERVICE_NAME,
                        event_type: outboxEvent.eventType,
                      });

                      end();

                      logger.error(
                        `Failed to publish outbox event ${outboxEvent.eventId}`,
                        err
                      );

                      outboxEvent.lastError = {
                        message: err.message,
                        stack: err.stack,
                      };

                      if (outboxEvent.attempts >= MAX_OUTBOX_ATTEMPTS) {
                        outboxEvent.status = "FAILED";
                        outboxEvent.failedAt = new Date();
                        outboxEvent.processingStartedAt = undefined;

                        await outboxEvent.save();

                        logger.error(
                          `Outbox event ${outboxEvent.eventId} permanently failed after ${outboxEvent.attempts} attempts.`
                        );

                      } else {
                        outboxEvent.status = "PENDING";
                        outboxEvent.processingStartedAt = undefined;

                        await outboxEvent.save();

                        logger.warn(
                          `Retrying outbox event ${outboxEvent.eventId}. Attempt ${outboxEvent.attempts}/${MAX_OUTBOX_ATTEMPTS}`
                        );
                      }
                    } finally {
                      span.end()
                    }
              })
            }
          )
        })
        } catch (err) {
          logger.error("Outbox worker failed", err);

          // Avoid a tight error loop if something unexpected happens
          await sleep(POLL_INTERVAL);
        }
  }
}

function stopOutboxWorker() {
  isRunning = false;
}

async function cleanupPublishedEvents() {
  const cutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  );

  const result = await OutboxEvent.deleteMany({
    status: "PUBLISHED",
    publishedAt: {
      $lt: cutoff,
    },
  });

  if (result.deletedCount > 0) {
    logger.info(
      `Deleted ${result.deletedCount} published outbox event(s).`
    );
  }
}

// async function processOutbox() {
//   while (true) {
//     try {
//         const pendingEvents = await OutboxEvent.find({
//         status: "PENDING",
//         })
//         .sort({ createdAt: 1 })
//         .limit(20);

//         for (const outboxEvent of pendingEvents) {
//             try {
//                 await publishEvent(outboxEvent.eventType, {
//                 eventId: outboxEvent.eventId,
//                 eventType: outboxEvent.eventType,
//                 occurredAt: outboxEvent.occurredAt,

//                 ...outboxEvent.payload,
//                 });

//                 outboxEvent.status = "PUBLISHED";
//                 outboxEvent.publishedAt = new Date();

//                 await outboxEvent.save();

//                 logger.info(
//                 `Published outbox event ${outboxEvent.eventId}`
//                 );
//             } catch (err) {
//                 logger.error(
//                 `Failed to publish outbox event ${outboxEvent.eventId}`,
//                 err
//                 );
//             }
//         }
//     } catch (err) {
//         logger.error("Outbox worker failed", err);
//     }

//     //More advanced approaches to reduce latency and unnecessary queries

//     //1. Change Data Capture (CDC) tools like Debezium, which stream database changes without polling.
//     //2. Database-specific notification mechanisms
//     //3. Enqueuing work directly into a job system
//     await sleep(POLL_INTERVAL);  // to avoid DB being hammered with pointless queries
//   }
// }

module.exports = { processOutbox, cleanupPublishedEvents, stopOutboxWorker };
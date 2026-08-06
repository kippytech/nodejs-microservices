//One consumer per queue per service instance (so every instance can handle any event type for that queue).
const amqp = require("amqplib");
const logger = require("./logger");
const requestContext = require("./requestContext")
const {
  rabbitmqEventsConsumedTotal,
  rabbitmqEventsFailedTotal,
  rabbitmqEventDuration,
} = require("./metrics")
const {
  propagation, context, trace, SpanStatusCode
} = require("@opentelemetry/api");

const tracer = trace.getTracer(process.env.SERVICE_NAME);

const RABBITMQ_URL = process.env.RABBITMQ_URL;

//const EXCHANGE_NAME = "social_network_events";
const EXCHANGE_NAME = "facebook_events";
const DLX_EXCHANGE = "facebook_events_dlx";

const SEARCH_QUEUE = "search_service_queue";
const SEARCH_DLQ = "search_queue_dlq";

let connection = null;
let channel = null;
let rabbitReady = false;

function markRabbitReady() {
  rabbitReady = true;
}

function markRabbitNotReady() {
  rabbitReady = false;
}

function isRabbitMQReady() {
  return rabbitReady;
}

// connect and initialize RabbitMQ
async function connectToRabbitMQ() {
  if (connection && channel) {
    return channel;
  }

  try {
    connection = await amqp.connect(RABBITMQ_URL);

    connection.on("close", () => {
      logger.warn("RabbitMQ connection closed.");

      connection = null;
      channel = null;
      markRabbitNotReady()
    });

    connection.on("error", (err) => {
      logger.error("RabbitMQ connection error.", err);
      markRabbitNotReady()
    });

    // connection.on("blocked", markRabbitNotReady);
    // connection.on("unblocked", markRabbitReady);
    connection.on("blocked", (reason) => {
      logger.warn(`RabbitMQ connection blocked: ${reason}`);

      markRabbitNotReady();
    });

    connection.on("unblocked", () => {
      logger.info("RabbitMQ connection unblocked.");

      markRabbitReady();
    });

    channel = await connection.createChannel();

    markRabbitReady()

    // Prevent one consumer from being flooded with messages.
    await channel.prefetch(10);

    await channel.assertExchange(EXCHANGE_NAME, "topic", {
      durable: true,
    });

    await channel.assertExchange(DLX_EXCHANGE, "topic", {
      durable: true,
    });

    await channel.assertQueue(SEARCH_QUEUE, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": DLX_EXCHANGE,
        "x-dead-letter-routing-key": SEARCH_DLQ,
      },
    });

    await channel.assertQueue(SEARCH_DLQ, {
      durable: true,
    });

    await channel.bindQueue(
      SEARCH_DLQ,
      DLX_EXCHANGE,
      SEARCH_DLQ
    );

    logger.info("Connected to RabbitMQ.");

    return channel;
  } catch (err) {
    logger.error("Failed to connect to RabbitMQ.", err);
    throw err;
  }
}

// subscribe the queue to a routing key.
async function bindEvent(routingKey) {
  if (!channel) {
    await connectToRabbitMQ();
  }

  await channel.bindQueue(
    SEARCH_QUEUE,
    EXCHANGE_NAME,
    routingKey
  );

  logger.info(`Bound "${routingKey}" to ${SEARCH_QUEUE}.`);
}

// start one consumer that dispatches messages to the correct handler.
async function startConsumer(handlers) {
  if (!channel) {
    await connectToRabbitMQ();
  }

  await channel.consume(SEARCH_QUEUE, async (msg) => {
    if (!msg) return;

    let end;
    let routingKey;

    try {
      routingKey = msg.fields.routingKey;
      const event = JSON.parse(msg.content.toString());
      const correlationId = msg.properties.headers?.["x-correlation-id"] ?? null;
      const parentContext =
        propagation.extract(
            context.active(),
            msg.properties.headers
        );

      end = rabbitmqEventDuration.startTimer({
        service: process.env.SERVICE_NAME,
        queue: SEARCH_QUEUE,
        routing_key: routingKey,
      });

      // handlers object: decides which business logic to execute based on msg.fields.routingKey.
      // eg const handlers = {
        //     "post.created": handlePostCreated,
        //     "post.deleted": handlePostDeleted,
        // };
      const handler = handlers[routingKey];  //eg handlePostCreated

      if (!handler) {
        rabbitmqEventsFailedTotal.inc({
          service: process.env.SERVICE_NAME,
          queue: SEARCH_QUEUE,
          routing_key: routingKey,
        });

        end();

        logger.warn(`No handler registered for "${routingKey}".`);

        // Reject only this message, don't retry it immediately.
        // channel.nack(message, allUpTo, requeue)
        channel.nack(msg, false, false);
        return;
      }

      //await handler(event);
      // await requestContext.run(
      //   { correlationId },
      //   () => handler(event)
      // )

      // await context.with(
      //           parentContext,
      
      //           async () => {
      
      //               await requestContext.run(
      //                   { correlationId },
      //                   () => handler(event)
      //               );
      
      //           }
      //       );
      await context.with(parentContext, async () => {
          await tracer.startActiveSpan(
              `Process ${routingKey}`,
              async (span) => {
                  try {
                      await requestContext.run(
                          { correlationId },
                          () => handler(event)
                      );

                      span.setAttributes({
                          //"event.type": routingKey,
                          "messaging.system": "rabbitmq",
                          "messaging.destination": event.eventType || routingKey,
                          "event.id": event.eventId,
                      });

                      span.setStatus({
                          code: SpanStatusCode.OK,
                      });

                  } catch (err) {

                      span.recordException(err);

                      span.setStatus({
                          code: SpanStatusCode.ERROR,
                      });

                      throw err;

                  } finally {

                      span.end();

                  }

              }
          );
      });

      rabbitmqEventsConsumedTotal.inc({
        service: process.env.SERVICE_NAME,
        queue: SEARCH_QUEUE,
        routing_key: routingKey,
      });

      end();

      channel.ack(msg);
    } catch (err) {
      rabbitmqEventsFailedTotal.inc({
        service: process.env.SERVICE_NAME,
        queue: SEARCH_QUEUE,
        routing_key: routingKey,
      });

      end();
      logger.error("Error processing event.", err);

      channel.nack(msg, false, false);
    }
  });

  logger.info(`Started consumer for "${SEARCH_QUEUE}".`);
}

function getRabbitMQChannel() {
  return channel;
}

async function closeRabbitMQ() {
  try {
    await channel?.close();
    await connection?.close();

    logger.info("RabbitMQ connection closed.");
  } catch (err) {
    logger.error("Error closing RabbitMQ.", err);
  } finally {
    channel = null;
    connection = null;
  }
}

module.exports = {
  connectToRabbitMQ,
  bindEvent,
  startConsumer,
  getRabbitMQChannel,
  closeRabbitMQ,
  isRabbitMQReady
};
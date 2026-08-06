const amqp = require("amqplib");
const logger = require("./logger");
const requestContext = require("./requestContext");
const {
  rabbitmqEventsConsumedTotal,
  rabbitmqEventsFailedTotal,
  rabbitmqEventDuration,
} = require("./metrics");
const {
  propagation, context, trace, SpanStatusCode
} = require("@opentelemetry/api");

const tracer = trace.getTracer(process.env.SERVICE_NAME);

const RABBITMQ_URL = process.env.RABBITMQ_URL;
//const EXCHANGE_NAME = "social_network_events";
const EXCHANGE_NAME = "facebook_events";
const DLX_EXCHANGE = "facebook_events_dlx";

const MEDIA_QUEUE = "media_service_queue"
const MEDIA_DLQ = "media_queue_dlq";

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

    channel = await connection.createConfirmChannel();

    markRabbitReady()

    // Prevent one consumer from being flooded with messages.
    await channel.prefetch(10);

    await channel.assertExchange(EXCHANGE_NAME, "topic", {
      durable: true,
    });

    await channel.assertExchange(DLX_EXCHANGE, "topic", {
      durable: true,
    });

    await channel.assertQueue(MEDIA_QUEUE, {
      durable: true,

      arguments: {
        "x-dead-letter-exchange": DLX_EXCHANGE,
        "x-dead-letter-routing-key": MEDIA_DLQ,
      },
    });

    await channel.assertQueue(MEDIA_DLQ, {
      durable: true,
    });

    await channel.bindQueue(
      MEDIA_DLQ,
      DLX_EXCHANGE,
      MEDIA_DLQ
    );

    logger.info("Connected to RabbitMQ.");

    return channel;
  } catch (err) {
    logger.error("Failed to connect to RabbitMQ.", err);
    throw err;
  }
}

async function publishEvent(routingKey, message) {
  if (!channel) {
    await connectToRabbitMQ();
  }

  return new Promise((resolve, reject) => {
    const published = channel.publish(
      EXCHANGE_NAME,
      routingKey,
      Buffer.from(JSON.stringify(message)),
      {
        persistent: true,
        contentType: "application/json",
      },
      (err) => {
        if (err) {
          logger.error(`Failed to publish ${routingKey}`, err);
          return reject(err);
        }

        logger.info(`Published ${routingKey}`);
        resolve();
      }
    );

    if (!published) {
      logger.warn("RabbitMQ write buffer is full.");
      channel.once("drain", () => {
        logger.info("RabbitMQ write buffer drained.");
      });
    }
  });
}

// async function consumeEvent(routingKey, handler) {
//   if (!channel) {
//     await connectToRabbitMQ();
//   }

//   const QUEUE_NAME = "media_service_queue";

//   // const { queue } = await channel.assertQueue("", {
//   //   exclusive: true,
//   // });
//   await channel.assertQueue(QUEUE_NAME, {
//     durable: true,
//     exclusive: false,
//     autoDelete: false,
//   });

//   await channel.bindQueue(
//     QUEUE_NAME, //queue,
//     EXCHANGE_NAME,
//     routingKey
//   );

//   await channel.consume(QUEUE_NAME, async (msg) => {
//     if (!msg) return;

//     try {
//       const content = JSON.parse(
//         msg.content.toString()
//       );

//       await handler(content);

//       channel.ack(msg);
//     } catch (err) {
//       logger.error(
//         `Error processing ${routingKey}`,
//         err
//       );

//       // Don't requeue by default
//       channel.nack(msg, false, false);
//     }
//   });

//   logger.info(`Subscribed to ${routingKey}`);
// }

// subscribe the queue to a routing key.
async function bindEvent(routingKey) {
  if (!channel) {
    await connectToRabbitMQ();
  }

  await channel.bindQueue(
    MEDIA_QUEUE,
    EXCHANGE_NAME,
    routingKey
  );

  logger.info(`Bound "${routingKey}" to ${MEDIA_QUEUE}.`);
}

// start one consumer that dispatches messages to the correct handler.
async function startConsumer(handlers) {
  if (!channel) {
    await connectToRabbitMQ();
  }

  await channel.consume(MEDIA_QUEUE, async (msg) => {
    if (!msg) return;

    let end;
    let routingKey;

    try {
      routingKey = msg.fields.routingKey;
      const event = JSON.parse(msg.content.toString());
      const correlationId = msg.properties.headers?.["x-correlation-id"] ?? null;
      logger.info("headers>>", msg.properties.headers);
      const parentContext =
        propagation.extract(
            context.active(),
            msg.properties.headers
        );

      end = rabbitmqEventDuration.startTimer({
        service: process.env.SERVICE_NAME,
        queue: MEDIA_QUEUE,
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
          queue: MEDIA_QUEUE,
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
      //run says For everything executed inside this callback, make this the current context
      // await requestContext.run(
      //   { correlationId },
      //   () => handler(event)
      // );
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
        queue: MEDIA_QUEUE,
        routing_key: routingKey,
      });

      end();

      channel.ack(msg);
    } catch (err) {
      logger.error("Error processing event.", err);

      rabbitmqEventsFailedTotal.inc({
        service: process.env.SERVICE_NAME,
        queue: MEDIA_QUEUE,
        routing_key: routingKey,
      });

      end();

      channel.nack(msg, false, false);
    }
  });

  logger.info(`Started consumer for "${MEDIA_QUEUE}".`);
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
  publishEvent,
  startConsumer,
  bindEvent,
  getRabbitMQChannel,
  closeRabbitMQ,
  isRabbitMQReady
};
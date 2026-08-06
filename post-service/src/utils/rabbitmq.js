const amqp = require("amqplib");
const logger = require("./logger");
const requestContext = require("./requestContext")

const RABBITMQ_URL = process.env.RABBITMQ_URL;
//const EXCHANGE_NAME = "social_network_events";
const EXCHANGE_NAME = "facebook_events";

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
  // Connection reuse
  if (connection && channel) {
    return channel;
  }

  try {
    connection = await amqp.connect(RABBITMQ_URL);

    // Resets the stored connection/channel when the connection closes and logs connection errors.
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
    // connection.on("unblocked", markRabbitReady)
    connection.on("blocked", (reason) => {
      logger.warn(`RabbitMQ connection blocked: ${reason}`);

      markRabbitNotReady();
    });

    connection.on("unblocked", () => {
      logger.info("RabbitMQ connection unblocked.");

      markRabbitReady();
    });

    // Create a channel that supports publisher confirms
    // Confirm channel gives publisher acknowledgements
    channel = await connection.createConfirmChannel();

    markRabbitReady();

    await channel.assertExchange(EXCHANGE_NAME, "topic", {
      durable: true,  // The exchange survives RabbitMQ restarts
    });

    logger.info("Connected to RabbitMQ.");

    return channel;
  } catch (err) {
    logger.error("Failed to connect to RabbitMQ.", err);
    // the error is rethrown or rejected so the caller can decide how to handle it.
    throw err;
  }
}

async function publishEvent(routingKey, message, headers = {}) {
  if (!channel) {
    await connectToRabbitMQ();
  }

  logger.info("headers>>", headers);

  const PUBLISH_TIMEOUT = 5000; // 5 seconds

  return new Promise((resolve, reject) => {
    //timeout prevents outbox worker hanging forever if RabbitMQ hangs
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Publisher confirm timed out after ${PUBLISH_TIMEOUT}ms for routingKey (${routingKey})`
        )
      );
    }, PUBLISH_TIMEOUT);

    console.log("publishEvent store:", requestContext.getStore());
    const store = requestContext.getStore();

    //Backpressure awareness
    const published = channel.publish(
      EXCHANGE_NAME,
      routingKey,
      Buffer.from(JSON.stringify(message)),
      {
        persistent: true,   // Messages are marked for persistence, so they can survive broker restarts when published to durable queues.
        contentType: "application/json",  // Consumers immediately know the payload format.
        headers,
      },
      (err) => {
        requestContext.run(store, () => {
          clearTimeout(timeout);

          if (err) {
            logger.error(`Failed to publish event "${routingKey}".`, err);
            return reject(err);
          }

          console.log("publishEvent store:", requestContext.getStore());

          logger.info(`Published event "${routingKey}".`);
          resolve();
        })
      }
    );

    if (!published) {
      logger.warn(
        "RabbitMQ write buffer is full. Waiting for drain..."
      );

      channel.once("drain", () => {
        logger.info("RabbitMQ write buffer drained.");
      });
    }
  });
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

;

module.exports = {
  connectToRabbitMQ,
  publishEvent,
  getRabbitMQChannel,
  closeRabbitMQ,
  isRabbitMQReady
};
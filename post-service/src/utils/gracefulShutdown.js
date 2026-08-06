const logger = require("./logger");

const cleanupTasks = [];

function registerCleanup(name, task) {
  cleanupTasks.push({ name, task });
}

async function shutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  for (const { name, task } of cleanupTasks) {
    try {
      logger.info(`Cleaning up ${name}...`);
      await task();
      logger.info(`${name} cleaned up.`);
    } catch (err) {
      logger.error(`Failed to clean up ${name}`, err);
    }
  }

  logger.info("Graceful shutdown complete.");

  process.exit(0);
}

function initializeGracefulShutdown() {
  ["SIGINT", "SIGTERM"].forEach((signal) => {
    process.once(signal, () => shutdown(signal));
  });
}

module.exports = {
  registerCleanup,
  initializeGracefulShutdown,
};
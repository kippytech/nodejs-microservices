const logger = require("./logger");

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retry(operation, name, delay = 5000) {
    while (true) {
        try {
            await operation();

            logger.info(`${name} is available.`);

            return;
        } catch (err) {
            logger.error(
                `${name} unavailable. Retrying in ${delay / 1000}s...`
            );

            await sleep(delay);
        }
    }
}

module.exports = retry;
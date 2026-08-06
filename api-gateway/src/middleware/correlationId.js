const { randomUUID } = require("node:crypto");
const requestContext = require("../utils/requestContext");

function correlationId(req, res, next) {
  const correlationId = req.headers["x-correlation-id"] || randomUUID();

  // Make it available to downstream middleware/routes/proxies.
  req.headers["x-correlation-id"] = correlationId;

  // Send it back to the client as well.
  res.setHeader("x-correlation-id", correlationId);

  requestContext.run(
    {
      correlationId,
    },
    next
  );
}

module.exports = correlationId;
const { randomUUID } = require("node:crypto");
const requestContext = require("../utils/requestContext");

function correlationId(req, res, next) {
  const correlationId = req.headers["x-correlation-id"] || randomUUID();

  res.setHeader("x-correlation-id", correlationId);

  requestContext.run(
    {
      correlationId,
    },
    next
  );
}

module.exports = correlationId;
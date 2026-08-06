const {
  httpRequestDuration,
  httpRequestsTotal,
} = require("../utils/metrics");

function metricsMiddleware(req, res, next) {
  if (
    req.path === "/metrics" ||
    req.path === "/api/health" ||
    req.path === "/api/ready"
  ) {
    return next();
  }

  const end = httpRequestDuration.startTimer();

  res.on("finish", () => {
    const labels = {
      service: process.env.SERVICE_NAME,
      
      method: req.method,

      route:
        req.route?.path ||
        req.baseUrl ||
        req.path,

      status_code: res.statusCode,
    };

    httpRequestsTotal.inc(labels);

    end(labels);
  });

  next();
}

module.exports = metricsMiddleware;
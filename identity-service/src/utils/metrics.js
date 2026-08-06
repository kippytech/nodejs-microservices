const client = require("prom-client");

// Default Node.js metrics
client.collectDefaultMetrics();

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",

  labelNames: [
    "service",
    "method",
    "route",
    "status_code",
  ],

  buckets: [
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1,
    2,
    5,
  ],
});

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",

  labelNames: [
    "service",
    "method",
    "route",
    "status_code",
  ],
});

module.exports = {
  register: client.register,

  httpRequestDuration,

  httpRequestsTotal,
};
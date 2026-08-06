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

const rabbitmqEventsConsumedTotal = new client.Counter({
  name: "rabbitmq_events_consumed_total",
  help: "Total RabbitMQ events successfully processed",

  labelNames: [
    "service",
    "queue",
    "routing_key",
  ],
});

const rabbitmqEventsFailedTotal = new client.Counter({
  name: "rabbitmq_events_failed_total",
  help: "Total RabbitMQ events that failed processing",

  labelNames: [
    "service",
    "queue",
    "routing_key",
  ],
});

const rabbitmqEventDuration = new client.Histogram({
  name: "rabbitmq_event_processing_duration_seconds",
  help: "Time spent processing RabbitMQ events",

  labelNames: [
    "service",
    "queue",
    "routing_key",
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

module.exports = {
  register: client.register,

  httpRequestDuration,
  httpRequestsTotal,

  rabbitmqEventDuration,
  rabbitmqEventsConsumedTotal,
  rabbitmqEventsFailedTotal
};
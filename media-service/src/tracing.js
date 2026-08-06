const { NodeSDK } = require("@opentelemetry/sdk-node");
const {
  getNodeAutoInstrumentations,
} = require("@opentelemetry/auto-instrumentations-node");
const {
  OTLPTraceExporter,
} = require("@opentelemetry/exporter-trace-otlp-grpc");

const sdk = new NodeSDK({
  serviceName: "media-service",

  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT, //"http://jaeger:4317",
  }),

  instrumentations: [
    //getNodeAutoInstrumentations(),
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-winston": {
        enabled: false,
      },
    }),
  ],
});

sdk.start();

process.on("SIGTERM", async () => {
  await sdk.shutdown();
});
process.on("SIGINT", async () => {
  await sdk.shutdown();
});

module.exports = sdk;
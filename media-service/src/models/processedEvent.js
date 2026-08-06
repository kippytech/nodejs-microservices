const mongoose = require("mongoose");

const processedEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,  //for idempotency handling of events by consumers
                     //prevents duplicate RabbitMQ events from creating jobs
    },

    processedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  }
);

module.exports = mongoose.model(
  "ProcessedEvent",
  processedEventSchema
);
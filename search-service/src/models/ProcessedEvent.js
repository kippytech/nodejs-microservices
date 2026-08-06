const mongoose = require("mongoose");

const processedEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,  //for idempotency handling of events by consumers
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
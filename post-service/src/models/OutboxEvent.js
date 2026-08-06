const mongoose = require("mongoose");

const outboxEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
    },

    eventType: {
      type: String,
      required: true,
      //index: true,
    },

    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    // published: {
    //   type: Boolean,
    //   default: false,
    //   index: true,
    // },
    status: {
        type: String,
        enum: ["PENDING", "PROCESSING", "PUBLISHED", "FAILED"],
        default: "PENDING",
        //index: true,
    },
    // to prevent two workers from claiming the same outbox event. A common solution is to add an intermediate state such as PROCESSING and atomically claim events (for example, with findOneAndUpdate or another atomic update) before publishing them. That way, even if you later scale the Post Service horizontally, each outbox event is processed by only one worker.

    processingStartedAt: Date,
    // a recovery job can detect events that have been in PROCESSING for, say, more than 5 minutes and safely move them back to PENDING for another worker to retry

    attempts: {
        type: Number,
        default: 0,
    },

    failedAt: {
      type: Date,
    },

    lastError: {
      message: String,
      stack: String,
    },

    publishedAt: Date,

    correlationId: {
        type: String,
        required: true,
    },
    traceHeaders: {
      type: mongoose.Schema.Types.Mixed, //or Map,  // or Object
      of: String,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

outboxEventSchema.index({
  status: 1,
  createdAt: 1,
});

outboxEventSchema.index({
  status: 1,
  publishedAt: 1,
});

outboxEventSchema.index({
  status: 1,
  processingStartedAt: 1,
});

module.exports = mongoose.model("OutboxEvent", outboxEventSchema);
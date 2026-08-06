const OutboxEvent = require("../models/outboxEvent");

const getOutboxEvents = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const filter = {};

    if (req.query.status) {
      filter.status = req.query.status.toUpperCase();
    }

    const [events, total] = await Promise.all([
      OutboxEvent.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      OutboxEvent.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      events,
    });
  } catch (err) {
    logger.error("Failed to fetch outbox events", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const retryOutboxEvent = async (req, res) => {
  try {
    const { eventId } = req.params;

    const outboxEvent = await OutboxEvent.findOne({
      eventId,
    });

    if (!outboxEvent) {
      return res.status(404).json({
        success: false,
        message: "Outbox event not found.",
      });
    }

    if (outboxEvent.status !== "FAILED") {
      return res.status(409).json({
        success: false,
        message:
          "Only FAILED events can be retried.",
      });
    }

    outboxEvent.status = "PENDING";
    outboxEvent.attempts = 0;
    outboxEvent.processingStartedAt = null;
    outboxEvent.lastError = null;

    await outboxEvent.save();

    logger.info(
      `Outbox event ${eventId} reset to PENDING`
    );

    return res.json({
      success: true,
      message: "Event queued for retry.",
    });
  } catch (err) {
    logger.error(
      "Failed to retry outbox event",
      err
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

const retryFailedOutboxEvents = async (req, res) => {
  try {
    const result = await OutboxEvent.updateMany(
      {
        status: "FAILED",
      },
      {
        $set: {
          status: "PENDING",
          processingStartedAt: null,
          lastError: null,
          attempts: 0,
        },
        $setOnInsert: {},
        $unset: {
          publishedAt: "",
        },
        //$inc: {},
      }
    );

    logger.info(
      `Reset ${result.modifiedCount} failed outbox events`
    );

    return res.json({
      success: true,
      message: `${result.modifiedCount} events queued for retry.`,
    });
  } catch (err) {
    logger.error(
      "Failed to retry failed outbox events",
      err
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

module.exports = {
  getOutboxEvents,
  retryOutboxEvent,
  retryFailedOutboxEvents,
};
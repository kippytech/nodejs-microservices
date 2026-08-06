const express = require("express");
const {getOutboxEvents, retryOutboxEvent, retryFailedOutboxEvents} = require("../controllers/outbox-admin-controller");
const { authenticateRequest } = require("../middleware/authMiddleware");

const router = express();

//middleware -> this will tell if the user is an auth user or not
router.use(authenticateRequest);

router.get(
  "/outbox",
  //authorize("admin"), // or whatever middleware for admin
  getOutboxEvents
);

router.get(
  "/outbox/:id/retry",
  //authorize("admin"), // or whatever middleware for admin
  retryOutboxEvent
);

router.get(
  "/outbox/retry-failed",
  //authorize("admin"), // or whatever middleware for admin
  retryFailedOutboxEvents
);
const express = require("express");

const {
  health,
  readiness,
} = require("../controllers/health-controller");

const router = express.Router();

router.get("/health", health);

router.get("/ready", readiness);

module.exports = router;
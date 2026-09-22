const express = require("express");
const db = require("../db");
const { requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const router = express.Router();

router.get(
  "/",
  requireRole("platform_admin"),
  asyncHandler(async (req, res) => {
    const schools = await db.all("SELECT * FROM schools ORDER BY created_at DESC");
    res.render("dashboard/platform", { title: "Platform Dashboard", schools });
  })
);

module.exports = router;

const express = require("express");
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const router = express.Router();

// Public (no auth) - navbar and report cards need to load this without a session check slowing things down
router.get(
  "/logo/:schoolId",
  asyncHandler(async (req, res) => {
    const school = await db.get("SELECT logo_data, logo_mime FROM schools WHERE id = $1", [req.params.schoolId]);
    if (!school || !school.logo_data) return res.status(404).end();
    const buffer = Buffer.from(school.logo_data, "base64");
    res.setHeader("Content-Type", school.logo_mime || "image/png");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(buffer);
  })
);

module.exports = router;

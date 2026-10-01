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

// Public - the login page has to load this before anyone is logged in
router.get(
  "/login-image/:schoolId",
  asyncHandler(async (req, res) => {
    const img = await db.get("SELECT image_data, image_mime FROM school_login_images WHERE school_id = $1", [req.params.schoolId]);
    if (!img) return res.status(404).end();
    res.setHeader("Content-Type", img.image_mime || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(Buffer.from(img.image_data, "base64"));
  })
);

module.exports = router;

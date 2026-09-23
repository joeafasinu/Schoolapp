const express = require("express");
const db = require("../db");
const { requireLogin } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const router = express.Router();

router.get(
  "/",
  requireLogin,
  asyncHandler(async (req, res) => {
    const user = req.session.user;
    if (user.role === "platform_admin") return res.redirect("/platform");

    const school = await db.get("SELECT * FROM schools WHERE id = $1", [user.school_id]);
    res.render("billing/view", { title: "Billing", school });
  })
);

module.exports = router;

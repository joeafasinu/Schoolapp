const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const router = express.Router();

router.use(requireRole("platform_admin"));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const schools = await db.all(
      `SELECT s.*, (SELECT COUNT(*) FROM users u WHERE u.school_id = s.id AND u.role = 'school_admin') as admin_count,
       (SELECT COUNT(*) FROM students st WHERE st.school_id = s.id) as student_count
       FROM schools s ORDER BY s.created_at DESC`
    );
    res.render("dashboard/platform", { title: "Platform Dashboard", schools, error: req.query.error || null });
  })
);

// Platform admin creates a school + its first admin account directly (assisted onboarding)
router.post(
  "/schools",
  asyncHandler(async (req, res) => {
    const { school_name, admin_name, email, password, trial_days } = req.body;
    if (!school_name || !admin_name || !email || !password) {
      return res.redirect("/platform?error=" + encodeURIComponent("All fields are required."));
    }
    const existing = await db.get("SELECT id FROM users WHERE email = $1", [email.trim().toLowerCase()]);
    if (existing) {
      return res.redirect("/platform?error=" + encodeURIComponent("An account with that email already exists."));
    }

    const days = parseInt(trial_days, 10) || 14;
    const trialEndsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const schoolId = await db.insert(
      "INSERT INTO schools (name, subscription_status, trial_ends_at) VALUES ($1, 'trial', $2) RETURNING id",
      [school_name.trim(), trialEndsAt]
    );
    const hash = bcrypt.hashSync(password, 10);
    await db.run(
      "INSERT INTO users (school_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'school_admin')",
      [schoolId, admin_name.trim(), email.trim().toLowerCase(), hash]
    );
    await db.run("INSERT INTO score_components (school_id, name, max_score, sort_order) VALUES ($1, $2, $3, $4)", [schoolId, "CA1", 20, 1]);
    await db.run("INSERT INTO score_components (school_id, name, max_score, sort_order) VALUES ($1, $2, $3, $4)", [schoolId, "CA2", 20, 2]);
    await db.run("INSERT INTO score_components (school_id, name, max_score, sort_order) VALUES ($1, $2, $3, $4)", [schoolId, "Exam", 60, 3]);
    await db.run(
      "INSERT INTO terms (school_id, session_name, term_name, is_active, total_school_days) VALUES ($1, $2, $3, 1, $4)",
      [schoolId, "2025/2026", "First Term", 60]
    );

    res.redirect("/platform");
  })
);

router.post(
  "/schools/:id/status",
  asyncHandler(async (req, res) => {
    const { status, extend_days } = req.body;
    if (status === "extend_trial") {
      const days = parseInt(extend_days, 10) || 14;
      await db.run(
        "UPDATE schools SET subscription_status = 'trial', trial_ends_at = GREATEST(COALESCE(trial_ends_at, NOW()), NOW()) + ($1 || ' days')::interval WHERE id = $2",
        [days, req.params.id]
      );
    } else if (["active", "suspended", "trial"].includes(status)) {
      await db.run("UPDATE schools SET subscription_status = $1 WHERE id = $2", [status, req.params.id]);
    }
    res.redirect("/platform");
  })
);

router.post(
  "/schools/:id/notes",
  asyncHandler(async (req, res) => {
    await db.run("UPDATE schools SET platform_notes = $1 WHERE id = $2", [req.body.notes || "", req.params.id]);
    res.redirect("/platform");
  })
);

module.exports = router;

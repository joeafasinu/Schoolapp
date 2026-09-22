const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const router = express.Router();

router.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.render("auth/login", { title: "Log In", error: null, user: null });
});

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const row = await db.get("SELECT * FROM users WHERE email = $1", [(email || "").trim().toLowerCase()]);
    if (!row || !bcrypt.compareSync(password || "", row.password_hash)) {
      return res.render("auth/login", { title: "Log In", error: "Invalid email or password.", user: null });
    }
    let schoolName = null;
    if (row.school_id) {
      const school = await db.get("SELECT name FROM schools WHERE id = $1", [row.school_id]);
      schoolName = school ? school.name : null;
    }
    req.session.user = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      school_id: row.school_id,
      school_name: schoolName,
    };
    res.redirect("/dashboard");
  })
);

router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// ---- New school self-signup (this is how you "sell to many schools") ----
router.get("/signup", (req, res) => {
  res.render("auth/signup", { title: "Register Your School", error: null, user: null });
});

router.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const { school_name, admin_name, email, password } = req.body;
    if (!school_name || !admin_name || !email || !password) {
      return res.render("auth/signup", { title: "Register Your School", error: "All fields are required.", user: null });
    }
    const existing = await db.get("SELECT id FROM users WHERE email = $1", [email.trim().toLowerCase()]);
    if (existing) {
      return res.render("auth/signup", { title: "Register Your School", error: "An account with that email already exists.", user: null });
    }
    const schoolId = await db.insert("INSERT INTO schools (name) VALUES ($1) RETURNING id", [school_name.trim()]);
    const hash = bcrypt.hashSync(password, 10);
    const userId = await db.insert(
      "INSERT INTO users (school_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'school_admin') RETURNING id",
      [schoolId, admin_name.trim(), email.trim().toLowerCase(), hash]
    );

    // seed default score components for the new school so it isn't empty
    await db.run("INSERT INTO score_components (school_id, name, max_score, sort_order) VALUES ($1, $2, $3, $4)", [schoolId, "CA1", 20, 1]);
    await db.run("INSERT INTO score_components (school_id, name, max_score, sort_order) VALUES ($1, $2, $3, $4)", [schoolId, "CA2", 20, 2]);
    await db.run("INSERT INTO score_components (school_id, name, max_score, sort_order) VALUES ($1, $2, $3, $4)", [schoolId, "Exam", 60, 3]);
    // seed a default term
    await db.run(
      "INSERT INTO terms (school_id, session_name, term_name, is_active, total_school_days) VALUES ($1, $2, $3, 1, $4)",
      [schoolId, "2025/2026", "First Term", 60]
    );

    req.session.user = {
      id: userId, name: admin_name.trim(), email: email.trim().toLowerCase(), role: "school_admin",
      school_id: schoolId, school_name: school_name.trim(),
    };
    res.redirect("/dashboard");
  })
);

module.exports = router;

const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const asyncHandler = require("../utils/asyncHandler");
const { uniqueSlug } = require("../utils/slug");
const router = express.Router();

async function getLoginSchool(slug) {
  if (!slug) return null;
  return db.get(
    `SELECT s.id, s.name, s.slug, s.login_tagline,
            (s.logo_data IS NOT NULL) AS has_logo,
            EXISTS (SELECT 1 FROM school_login_images li WHERE li.school_id = s.id) AS has_login_image
     FROM schools s WHERE s.slug = $1`,
    [slug]
  );
}

function renderLogin(res, { error = null, school = null } = {}) {
  res.render("auth/login", { title: school ? `${school.name} · Log In` : "Log In", error, school, user: null });
}

router.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  renderLogin(res);
});

router.get(
  "/s/:slug",
  asyncHandler(async (req, res) => {
    if (req.session.user) return res.redirect("/dashboard");
    const school = await getLoginSchool(req.params.slug);
    if (!school) return res.status(404).render("error", { message: "We couldn't find that school's login page.", user: null });
    renderLogin(res, { school });
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password, school_slug } = req.body;
    const row = await db.get("SELECT * FROM users WHERE email = $1", [(email || "").trim().toLowerCase()]);
    if (!row || !bcrypt.compareSync(password || "", row.password_hash)) {
      const school = await getLoginSchool(school_slug);
      return renderLogin(res, { error: "Invalid email or password.", school });
    }
    let schoolName = null;
    if (row.school_id) {
      const school = await db.get("SELECT name FROM schools WHERE id = $1", [row.school_id]);
      schoolName = school ? school.name : null;
    }
    req.session.user = {
      id: row.id, name: row.name, email: row.email, role: row.role,
      school_id: row.school_id, school_name: schoolName,
    };
    res.redirect("/dashboard");
  })
);

router.get(
  "/logout",
  asyncHandler(async (req, res) => {
    let target = "/login";
    const u = req.session.user;
    if (u && u.school_id) {
      const s = await db.get("SELECT slug FROM schools WHERE id = $1", [u.school_id]);
      if (s && s.slug) target = "/s/" + s.slug;
    }
    req.session.destroy(() => res.redirect(target));
  })
);

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
    const slug = await uniqueSlug(school_name, db);
    const schoolId = await db.insert(
      "INSERT INTO schools (name, slug, subscription_status, trial_ends_at) VALUES ($1, $2, 'trial', $3) RETURNING id",
      [school_name.trim(), slug, new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)]
    );
    const hash = bcrypt.hashSync(password, 10);
    const userId = await db.insert(
      "INSERT INTO users (school_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'school_admin') RETURNING id",
      [schoolId, admin_name.trim(), email.trim().toLowerCase(), hash]
    );

    await db.run("INSERT INTO score_components (school_id, name, max_score, sort_order) VALUES ($1, $2, $3, $4)", [schoolId, "CA1", 20, 1]);
    await db.run("INSERT INTO score_components (school_id, name, max_score, sort_order) VALUES ($1, $2, $3, $4)", [schoolId, "CA2", 20, 2]);
    await db.run("INSERT INTO score_components (school_id, name, max_score, sort_order) VALUES ($1, $2, $3, $4)", [schoolId, "Exam", 60, 3]);
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

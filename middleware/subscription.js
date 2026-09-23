const db = require("../db");

// Blocks access to core work (scores, attendance, broadsheet, setup, report cards)
// once a school's trial has expired and they haven't been marked active by the platform admin.
// Platform admin is never gated (school_id is null for that role).
async function requireActiveSubscription(req, res, next) {
  const user = req.session.user;
  if (!user || user.role === "platform_admin") return next();

  const school = await db.get("SELECT subscription_status, trial_ends_at FROM schools WHERE id = $1", [user.school_id]);
  if (!school) return next(); // shouldn't happen, but don't hard-block on a data issue

  if (school.subscription_status === "active") return next();

  if (school.subscription_status === "trial") {
    const stillInTrial = school.trial_ends_at && new Date(school.trial_ends_at) > new Date();
    if (stillInTrial) return next();
  }

  // trial expired or explicitly suspended
  return res.redirect("/billing");
}

module.exports = { requireActiveSubscription };

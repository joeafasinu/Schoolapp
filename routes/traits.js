const express = require("express");
const db = require("../db");
const { requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const router = express.Router();

async function getActiveTerm(schoolId) {
  return db.get("SELECT * FROM terms WHERE school_id = $1 AND is_active = 1 ORDER BY id DESC LIMIT 1", [schoolId]);
}

router.get(
  "/",
  requireRole("teacher", "school_admin"),
  asyncHandler(async (req, res) => {
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    if (!term) return res.render("error", { message: "No active term. Ask the school admin to start one." });

    const traits = await db.all("SELECT * FROM report_traits WHERE school_id = $1 ORDER BY category, sort_order, id", [schoolId]);
    if (traits.length === 0) {
      return res.render("error", { message: "No report card sections have been set up yet. Ask your school admin to add some under Setup → Report Sections." });
    }

    let classId = req.query.class_id;
    if (!classId) {
      const formClass = await db.get("SELECT * FROM classes WHERE form_teacher_id = $1 AND school_id = $2", [req.session.user.id, schoolId]);
      classId = formClass ? formClass.id : null;
    }
    const classes = await db.all("SELECT * FROM classes WHERE school_id = $1 ORDER BY name", [schoolId]);
    if (!classId) {
      return res.render("traits/pick", { title: "Report Card Sections", classes });
    }

    const klass = await db.get("SELECT * FROM classes WHERE id = $1", [classId]);
    const students = await db.all("SELECT * FROM students WHERE class_id = $1 ORDER BY full_name", [classId]);
    const existing = await db.all(
      `SELECT student_id, trait_id, rating FROM student_trait_ratings WHERE term_id = $1 AND student_id IN
       (SELECT id FROM students WHERE class_id = $2)`,
      [term.id, classId]
    );
    const ratingMap = {};
    existing.forEach((r) => (ratingMap[`${r.student_id}_${r.trait_id}`] = r.rating));

    res.render("traits/entry", { title: "Report Card Sections", klass, classes, students, traits, ratingMap, term });
  })
);

router.post(
  "/:classId",
  requireRole("teacher", "school_admin"),
  asyncHandler(async (req, res) => {
    const { classId } = req.params;
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    if (!term) return res.redirect("/traits");

    const students = await db.all("SELECT id FROM students WHERE class_id = $1", [classId]);
    const traits = await db.all("SELECT id FROM report_traits WHERE school_id = $1", [schoolId]);

    const upsertSql = `
      INSERT INTO student_trait_ratings (school_id, term_id, student_id, trait_id, rating)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (term_id, student_id, trait_id)
      DO UPDATE SET rating = EXCLUDED.rating
    `;
    for (const s of students) {
      for (const t of traits) {
        const fieldName = `rating_${s.id}_${t.id}`;
        const value = req.body[fieldName];
        if (value === undefined || value === "") continue;
        await db.run(upsertSql, [schoolId, term.id, s.id, t.id, value.trim()]);
      }
    }

    res.redirect(`/traits?class_id=${classId}&saved=1`);
  })
);

module.exports = router;

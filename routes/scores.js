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
  requireRole("teacher"),
  asyncHandler(async (req, res) => {
    const assignments = await db.all(
      `SELECT ta.*, c.name as class_name, s.name as subject_name
       FROM teacher_assignments ta
       JOIN classes c ON c.id = ta.class_id
       JOIN subjects s ON s.id = ta.subject_id
       WHERE ta.teacher_id = $1`,
      [req.session.user.id]
    );
    res.render("scores/pick", { title: "Enter Scores", assignments });
  })
);

router.get(
  "/:classId/:subjectId",
  requireRole("teacher", "school_admin"),
  asyncHandler(async (req, res) => {
    const { classId, subjectId } = req.params;
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    if (!term) return res.render("error", { message: "No active term. Ask the school admin to start one." });

    if (req.session.user.role === "teacher") {
      const assigned = await db.get(
        "SELECT id FROM teacher_assignments WHERE teacher_id = $1 AND class_id = $2 AND subject_id = $3",
        [req.session.user.id, classId, subjectId]
      );
      if (!assigned) return res.render("error", { message: "You are not assigned to this class/subject." });
    }

    const klass = await db.get("SELECT * FROM classes WHERE id = $1", [classId]);
    const subject = await db.get("SELECT * FROM subjects WHERE id = $1", [subjectId]);
    const components = await db.all("SELECT * FROM score_components WHERE school_id = $1 ORDER BY sort_order", [schoolId]);
    const students = await db.all("SELECT * FROM students WHERE class_id = $1 ORDER BY full_name", [classId]);

    const studentIds = students.map((s) => s.id);
    let existingScores = [];
    if (studentIds.length) {
      existingScores = await db.all(
        `SELECT student_id, component_id, score FROM scores WHERE term_id = $1 AND subject_id = $2 AND student_id = ANY($3::int[])`,
        [term.id, subjectId, studentIds]
      );
    }

    const scoreMap = {};
    existingScores.forEach((row) => {
      scoreMap[`${row.student_id}_${row.component_id}`] = row.score;
    });

    res.render("scores/entry", { title: "Enter Scores", klass, subject, components, students, scoreMap, term });
  })
);

router.post(
  "/:classId/:subjectId",
  requireRole("teacher", "school_admin"),
  asyncHandler(async (req, res) => {
    const { classId, subjectId } = req.params;
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    if (!term) return res.redirect("/scores");

    const components = await db.all("SELECT * FROM score_components WHERE school_id = $1", [schoolId]);
    const students = await db.all("SELECT * FROM students WHERE class_id = $1", [classId]);

    const upsertSql = `
      INSERT INTO scores (school_id, term_id, student_id, subject_id, component_id, score, entered_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (term_id, student_id, subject_id, component_id)
      DO UPDATE SET score = EXCLUDED.score, entered_by = EXCLUDED.entered_by, updated_at = NOW()
    `;

    for (const student of students) {
      for (const comp of components) {
        const fieldName = `score_${student.id}_${comp.id}`;
        const raw = req.body[fieldName];
        if (raw === undefined || raw === "") continue;
        let value = parseFloat(raw);
        if (isNaN(value)) value = 0;
        if (value > comp.max_score) value = comp.max_score;
        if (value < 0) value = 0;
        await db.run(upsertSql, [schoolId, term.id, student.id, subjectId, comp.id, value, req.session.user.id]);
      }
    }

    res.redirect(`/scores/${classId}/${subjectId}?saved=1`);
  })
);

module.exports = router;

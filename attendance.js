const express = require("express");
const db = require("../db");
const { requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const router = express.Router();

async function getActiveTerm(schoolId) {
  return db.get("SELECT * FROM terms WHERE school_id = $1 AND is_active = 1 ORDER BY id DESC LIMIT 1", [schoolId]);
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

router.get(
  "/",
  requireRole("teacher", "school_admin"),
  asyncHandler(async (req, res) => {
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    if (!term) return res.render("error", { message: "No active term. Ask the school admin to start one." });

    let classId = req.query.class_id;
    if (!classId) {
      const formClass = await db.get("SELECT * FROM classes WHERE form_teacher_id = $1 AND school_id = $2", [req.session.user.id, schoolId]);
      classId = formClass ? formClass.id : null;
    }
    const classes = await db.all("SELECT * FROM classes WHERE school_id = $1", [schoolId]);
    if (!classId) {
      return res.render("attendance/pick", { title: "Attendance", classes });
    }

    const klass = await db.get("SELECT * FROM classes WHERE id = $1", [classId]);
    const date = req.query.date || todayStr();
    const students = await db.all("SELECT * FROM students WHERE class_id = $1 ORDER BY full_name", [classId]);
    const existing = await db.all("SELECT student_id, status FROM attendance WHERE term_id = $1 AND class_id = $2 AND date = $3", [
      term.id, classId, date,
    ]);
    const statusMap = {};
    existing.forEach((r) => (statusMap[r.student_id] = r.status));

    res.render("attendance/mark", { title: "Attendance", klass, classes, students, statusMap, date, term });
  })
);

router.post(
  "/:classId",
  requireRole("teacher", "school_admin"),
  asyncHandler(async (req, res) => {
    const { classId } = req.params;
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    if (!term) return res.redirect("/attendance");
    const date = req.body.date || todayStr();
    const students = await db.all("SELECT id FROM students WHERE class_id = $1", [classId]);

    const upsertSql = `
      INSERT INTO attendance (school_id, term_id, class_id, student_id, date, status, marked_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (term_id, student_id, date)
      DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by
    `;
    for (const s of students) {
      const status = req.body[`status_${s.id}`] || "present";
      await db.run(upsertSql, [schoolId, term.id, classId, s.id, date, status, req.session.user.id]);
    }

    res.redirect(`/attendance?class_id=${classId}&date=${date}&saved=1`);
  })
);

module.exports = router;

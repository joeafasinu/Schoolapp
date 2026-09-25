const express = require("express");
const db = require("../db");
const { requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { todayLagosStr, isPastNoonLagos } = require("../utils/time");
const router = express.Router();

async function getActiveTerm(schoolId) {
  return db.get("SELECT * FROM terms WHERE school_id = $1 AND is_active = 1 ORDER BY id DESC LIMIT 1", [schoolId]);
}

// Teachers can only mark/edit TODAY's attendance, and only before noon (Lagos time).
// School admins are never restricted - they may need to fix a mistake any time.
function teacherIsLockedOut(role, date) {
  if (role !== "teacher") return false;
  const today = todayLagosStr();
  if (date !== today) return true; // teachers don't backfill or edit other days
  return isPastNoonLagos();
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
    const date = req.query.date || todayLagosStr();
    const students = await db.all("SELECT * FROM students WHERE class_id = $1 ORDER BY full_name", [classId]);
    const existing = await db.all("SELECT student_id, status FROM attendance WHERE term_id = $1 AND class_id = $2 AND date = $3", [
      term.id, classId, date,
    ]);
    const statusMap = {};
    existing.forEach((r) => (statusMap[r.student_id] = r.status));

    const locked = teacherIsLockedOut(req.session.user.role, date);

    res.render("attendance/mark", {
      title: "Attendance", klass, classes, students, statusMap, date, term, locked,
      todayStr: todayLagosStr(), error: req.query.error || null,
    });
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
    const date = req.body.date || todayLagosStr();

    if (teacherIsLockedOut(req.session.user.role, date)) {
      return res.redirect(
        `/attendance?class_id=${classId}&date=${date}&error=` +
          encodeURIComponent("Attendance marking closes at 12:00 PM each day and reopens the next morning. Ask your school admin if you need a correction made.")
      );
    }

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

// ===================== SCHOOL-WIDE DAILY SUMMARY (school admin) =====================
router.get(
  "/summary",
  requireRole("school_admin"),
  asyncHandler(async (req, res) => {
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    if (!term) return res.render("error", { message: "No active term set." });

    const date = req.query.date || todayLagosStr();

    const byClass = await db.all(
      `SELECT c.id as class_id, c.name as class_name,
              COUNT(a.id) as marked,
              SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) as present,
              SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent,
              SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) as late,
              SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) as excused,
              (SELECT COUNT(*) FROM students st WHERE st.class_id = c.id) as roll
       FROM classes c
       LEFT JOIN attendance a ON a.class_id = c.id AND a.date = $1 AND a.term_id = $2
       WHERE c.school_id = $3
       GROUP BY c.id, c.name ORDER BY c.name`,
      [date, term.id, schoolId]
    );

    const totals = byClass.reduce(
      (acc, r) => {
        acc.roll += Number(r.roll);
        acc.present += Number(r.present);
        acc.absent += Number(r.absent);
        acc.late += Number(r.late);
        acc.excused += Number(r.excused);
        acc.marked += Number(r.marked);
        return acc;
      },
      { roll: 0, present: 0, absent: 0, late: 0, excused: 0, marked: 0 }
    );
    totals.rate = totals.roll > 0 ? Math.round((totals.present / totals.roll) * 1000) / 10 : 0;

    // Term-to-date trend: one row per day that has any attendance recorded, across the whole school
    const trend = await db.all(
      `SELECT a.date,
              COUNT(DISTINCT a.student_id) as marked,
              SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) as present,
              SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent
       FROM attendance a
       WHERE a.school_id = $1 AND a.term_id = $2
       GROUP BY a.date ORDER BY a.date DESC LIMIT 30`,
      [schoolId, term.id]
    );

    res.render("attendance/summary", { title: "Attendance Summary", byClass, totals, trend, date, term });
  })
);

module.exports = router;

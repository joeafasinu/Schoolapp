const express = require("express");
const db = require("../db");
const { requireLogin } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { getFeeSummary, summarizeFeeRows, formatNaira } = require("../utils/fees");
const router = express.Router();

router.get(
  "/",
  requireLogin,
  asyncHandler(async (req, res) => {
    const user = req.session.user;

    if (user.role === "platform_admin") {
      const schools = await db.all(
        `SELECT s.*, (SELECT COUNT(*) FROM users u WHERE u.school_id = s.id AND u.role = 'school_admin') as admin_count,
         (SELECT COUNT(*) FROM students st WHERE st.school_id = s.id) as student_count
         FROM schools s ORDER BY s.created_at DESC`
      );
      return res.render("dashboard/platform", { title: "Platform Dashboard", schools, error: null });
    }

    const schoolId = user.school_id;
    const school = await db.get("SELECT subscription_status, trial_ends_at FROM schools WHERE id = $1", [schoolId]);
    const activeTerm = await db.get("SELECT * FROM terms WHERE school_id = $1 AND is_active = 1 ORDER BY id DESC LIMIT 1", [schoolId]);

    if (user.role === "school_admin") {
      const [classesCount, subjectsCount, studentsCount, teachersCount] = await Promise.all([
        db.get("SELECT COUNT(*) c FROM classes WHERE school_id = $1", [schoolId]),
        db.get("SELECT COUNT(*) c FROM subjects WHERE school_id = $1", [schoolId]),
        db.get("SELECT COUNT(*) c FROM students WHERE school_id = $1", [schoolId]),
        db.get("SELECT COUNT(*) c FROM users WHERE school_id = $1 AND role = 'teacher'", [schoolId]),
      ]);
      const counts = {
        classes: Number(classesCount.c),
        subjects: Number(subjectsCount.c),
        students: Number(studentsCount.c),
        teachers: Number(teachersCount.c),
      };
      const classes = await db.all("SELECT * FROM classes WHERE school_id = $1 ORDER BY name", [schoolId]);
      return res.render("dashboard/school_admin", { title: "Dashboard", counts, classes, activeTerm, school });
    }

    if (user.role === "teacher") {
      const assignments = await db.all(
        `SELECT ta.*, c.name as class_name, s.name as subject_name
         FROM teacher_assignments ta
         JOIN classes c ON c.id = ta.class_id
         JOIN subjects s ON s.id = ta.subject_id
         WHERE ta.teacher_id = $1`,
        [user.id]
      );
      const formClass = await db.get("SELECT * FROM classes WHERE form_teacher_id = $1 AND school_id = $2", [user.id, schoolId]);
      return res.render("dashboard/teacher", { title: "Dashboard", assignments, formClass, activeTerm, school });
    }

    if (user.role === "bursar") {
      if (!activeTerm) {
        return res.render("dashboard/bursar", {
          title: "Fee Dashboard", activeTerm: null, rows: [], stats: { totalCollected: 0, totalOutstanding: 0, totalExpected: 0, overdueCount: 0 },
          formatNaira, statusFilter: null,
        });
      }
      let rows = await getFeeSummary(schoolId, activeTerm.id);
      const statusFilter = req.query.status || "";
      if (statusFilter === "Overdue") rows = rows.filter((r) => r.overdue);
      else if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
      const stats = summarizeFeeRows(await getFeeSummary(schoolId, activeTerm.id)); // stats always over the full set, not the filtered view
      return res.render("dashboard/bursar", { title: "Fee Dashboard", activeTerm, rows, stats, formatNaira, statusFilter });
    }

    res.redirect("/login");
  })
);

module.exports = router;

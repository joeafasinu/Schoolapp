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

    if (user.role === "platform_admin") {
      const schools = await db.all("SELECT * FROM schools ORDER BY created_at DESC");
      return res.render("dashboard/platform", { title: "Platform Dashboard", schools });
    }

    const schoolId = user.school_id;
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
      return res.render("dashboard/school_admin", { title: "Dashboard", counts, classes, activeTerm });
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
      return res.render("dashboard/teacher", { title: "Dashboard", assignments, formClass, activeTerm });
    }

    res.redirect("/login");
  })
);

module.exports = router;

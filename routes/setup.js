const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const db = require("../db");
const { requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 }, // 1MB - logos should be small; keeps DB storage cheap
  fileFilter: (req, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Please upload a PNG, JPG, WEBP or SVG image."), ok);
  },
});

router.use(requireRole("school_admin"));

function schoolId(req) {
  return req.session.user.school_id;
}

// ===================== CLASSES =====================
router.get(
  "/classes",
  asyncHandler(async (req, res) => {
    const classes = await db.all(
      `SELECT c.*, u.name as teacher_name, (SELECT COUNT(*) FROM students st WHERE st.class_id = c.id) as student_count
       FROM classes c LEFT JOIN users u ON u.id = c.form_teacher_id
       WHERE c.school_id = $1 ORDER BY c.name`,
      [schoolId(req)]
    );
    const teachers = await db.all("SELECT * FROM users WHERE school_id = $1 AND role = 'teacher'", [schoolId(req)]);
    res.render("setup/classes", { title: "Classes", classes, teachers });
  })
);

router.post(
  "/classes",
  asyncHandler(async (req, res) => {
    const { name, form_teacher_id } = req.body;
    await db.run("INSERT INTO classes (school_id, name, form_teacher_id) VALUES ($1, $2, $3)", [
      schoolId(req), name.trim(), form_teacher_id || null,
    ]);
    res.redirect("/setup/classes");
  })
);

router.delete(
  "/classes/:id",
  asyncHandler(async (req, res) => {
    await db.run("DELETE FROM classes WHERE id = $1 AND school_id = $2", [req.params.id, schoolId(req)]);
    res.redirect("/setup/classes");
  })
);

// ===================== SUBJECTS =====================
router.get(
  "/subjects",
  asyncHandler(async (req, res) => {
    const subjects = await db.all("SELECT * FROM subjects WHERE school_id = $1 ORDER BY name", [schoolId(req)]);
    res.render("setup/subjects", { title: "Subjects", subjects });
  })
);

router.post(
  "/subjects",
  asyncHandler(async (req, res) => {
    await db.run("INSERT INTO subjects (school_id, name) VALUES ($1, $2)", [schoolId(req), req.body.name.trim()]);
    res.redirect("/setup/subjects");
  })
);

router.delete(
  "/subjects/:id",
  asyncHandler(async (req, res) => {
    await db.run("DELETE FROM subjects WHERE id = $1 AND school_id = $2", [req.params.id, schoolId(req)]);
    res.redirect("/setup/subjects");
  })
);

// ===================== STUDENTS =====================
router.get(
  "/students",
  asyncHandler(async (req, res) => {
    const classFilter = req.query.class_id || null;
    const classes = await db.all("SELECT * FROM classes WHERE school_id = $1 ORDER BY name", [schoolId(req)]);
    let students;
    if (classFilter) {
      students = await db.all(
        "SELECT s.*, c.name as class_name FROM students s JOIN classes c ON c.id = s.class_id WHERE s.school_id = $1 AND s.class_id = $2 ORDER BY s.full_name",
        [schoolId(req), classFilter]
      );
    } else {
      students = await db.all(
        "SELECT s.*, c.name as class_name FROM students s JOIN classes c ON c.id = s.class_id WHERE s.school_id = $1 ORDER BY c.name, s.full_name",
        [schoolId(req)]
      );
    }
    res.render("setup/students", { title: "Students", students, classes, classFilter });
  })
);

router.post(
  "/students",
  asyncHandler(async (req, res) => {
    const { full_name, admission_no, class_id, gender, guardian_name, guardian_email, guardian_phone } = req.body;
    await db.run(
      `INSERT INTO students (school_id, class_id, admission_no, full_name, gender, guardian_name, guardian_email, guardian_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [schoolId(req), class_id, admission_no, full_name.trim(), gender, guardian_name, guardian_email, guardian_phone]
    );
    res.redirect("/setup/students");
  })
);

router.delete(
  "/students/:id",
  asyncHandler(async (req, res) => {
    await db.run("DELETE FROM students WHERE id = $1 AND school_id = $2", [req.params.id, schoolId(req)]);
    res.redirect("/setup/students");
  })
);

// ===================== TEACHERS + ASSIGNMENTS =====================
router.get(
  "/teachers",
  asyncHandler(async (req, res) => {
    const teachers = await db.all("SELECT * FROM users WHERE school_id = $1 AND role = 'teacher' ORDER BY name", [schoolId(req)]);
    const classes = await db.all("SELECT * FROM classes WHERE school_id = $1 ORDER BY name", [schoolId(req)]);
    const subjects = await db.all("SELECT * FROM subjects WHERE school_id = $1 ORDER BY name", [schoolId(req)]);
    const assignments = await db.all(
      `SELECT ta.*, u.name as teacher_name, c.name as class_name, s.name as subject_name
       FROM teacher_assignments ta
       JOIN users u ON u.id = ta.teacher_id
       JOIN classes c ON c.id = ta.class_id
       JOIN subjects s ON s.id = ta.subject_id
       WHERE ta.school_id = $1 ORDER BY u.name`,
      [schoolId(req)]
    );
    res.render("setup/teachers", { title: "Teachers", teachers, classes, subjects, assignments });
  })
);

router.post(
  "/teachers",
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    const existing = await db.get("SELECT id FROM users WHERE email = $1", [email.trim().toLowerCase()]);
    if (existing) return res.redirect("/setup/teachers?error=exists");
    const hash = bcrypt.hashSync(password || "teacher123", 10);
    await db.run("INSERT INTO users (school_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'teacher')", [
      schoolId(req), name.trim(), email.trim().toLowerCase(), hash,
    ]);
    res.redirect("/setup/teachers");
  })
);

router.delete(
  "/teachers/:id",
  asyncHandler(async (req, res) => {
    await db.run("DELETE FROM users WHERE id = $1 AND school_id = $2 AND role = 'teacher'", [req.params.id, schoolId(req)]);
    res.redirect("/setup/teachers");
  })
);

router.post(
  "/assignments",
  asyncHandler(async (req, res) => {
    const { teacher_id, class_id, subject_id } = req.body;
    try {
      await db.run("INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id) VALUES ($1, $2, $3, $4)", [
        schoolId(req), teacher_id, class_id, subject_id,
      ]);
    } catch (e) {
      /* ignore duplicate assignment (unique constraint) */
    }
    res.redirect("/setup/teachers");
  })
);

router.delete(
  "/assignments/:id",
  asyncHandler(async (req, res) => {
    await db.run("DELETE FROM teacher_assignments WHERE id = $1 AND school_id = $2", [req.params.id, schoolId(req)]);
    res.redirect("/setup/teachers");
  })
);

// ===================== TERMS =====================
router.get(
  "/terms",
  asyncHandler(async (req, res) => {
    const terms = await db.all("SELECT * FROM terms WHERE school_id = $1 ORDER BY id DESC", [schoolId(req)]);
    res.render("setup/terms", { title: "Terms & Sessions", terms });
  })
);

router.post(
  "/terms",
  asyncHandler(async (req, res) => {
    const { session_name, term_name, total_school_days } = req.body;
    await db.run("UPDATE terms SET is_active = 0 WHERE school_id = $1", [schoolId(req)]);
    await db.run(
      "INSERT INTO terms (school_id, session_name, term_name, is_active, total_school_days) VALUES ($1, $2, $3, 1, $4)",
      [schoolId(req), session_name.trim(), term_name.trim(), total_school_days || 0]
    );
    res.redirect("/setup/terms");
  })
);

router.post(
  "/terms/:id/activate",
  asyncHandler(async (req, res) => {
    await db.run("UPDATE terms SET is_active = 0 WHERE school_id = $1", [schoolId(req)]);
    await db.run("UPDATE terms SET is_active = 1 WHERE id = $1 AND school_id = $2", [req.params.id, schoolId(req)]);
    res.redirect("/setup/terms");
  })
);

// ===================== BRANDING (logo upload) =====================
router.get(
  "/branding",
  asyncHandler(async (req, res) => {
    const school = await db.get("SELECT * FROM schools WHERE id = $1", [schoolId(req)]);
    res.render("setup/branding", { title: "Branding", school, error: req.query.error || null, saved: req.query.saved || null });
  })
);

router.post(
  "/branding",
  (req, res, next) => {
    upload.single("logo")(req, res, (err) => {
      if (err) return res.redirect("/setup/branding?error=" + encodeURIComponent(err.message));
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const { primary_color } = req.body;
    if (req.file) {
      const base64 = req.file.buffer.toString("base64");
      await db.run("UPDATE schools SET logo_data = $1, logo_mime = $2 WHERE id = $3", [base64, req.file.mimetype, schoolId(req)]);
    }
    if (primary_color) {
      await db.run("UPDATE schools SET primary_color = $1 WHERE id = $2", [primary_color, schoolId(req)]);
    }
    res.redirect("/setup/branding?saved=1");
  })
);

router.post(
  "/branding/remove-logo",
  asyncHandler(async (req, res) => {
    await db.run("UPDATE schools SET logo_data = NULL, logo_mime = NULL WHERE id = $1", [schoolId(req)]);
    res.redirect("/setup/branding?saved=1");
  })
);

module.exports = router;

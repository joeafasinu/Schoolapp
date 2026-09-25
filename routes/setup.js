const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { parse } = require("csv-parse/sync");
const db = require("../db");
const { requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { friendlyDelete } = require("../utils/friendlyDelete");
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 }, // 1MB - logos should be small; keeps DB storage cheap
  fileFilter: (req, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Please upload a PNG, JPG, WEBP or SVG image."), ok);
  },
});

const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB is plenty for a few thousand student rows
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === "text/csv" || file.originalname.toLowerCase().endsWith(".csv");
    cb(ok ? null : new Error("Please upload a .csv file."), ok);
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
    res.render("setup/classes", { title: "Classes", classes, teachers, error: req.query.error || null });
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
    await friendlyDelete(
      "DELETE FROM classes WHERE id = $1 AND school_id = $2",
      [req.params.id, schoolId(req)],
      res, "/setup/classes", "class"
    );
  })
);

// ===================== SUBJECTS =====================
router.get(
  "/subjects",
  asyncHandler(async (req, res) => {
    const subjects = await db.all("SELECT * FROM subjects WHERE school_id = $1 ORDER BY name", [schoolId(req)]);
    res.render("setup/subjects", { title: "Subjects", subjects, error: req.query.error || null });
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
    await friendlyDelete(
      "DELETE FROM subjects WHERE id = $1 AND school_id = $2",
      [req.params.id, schoolId(req)],
      res, "/setup/subjects", "subject"
    );
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
    res.render("setup/students", { title: "Students", students, classes, classFilter, error: req.query.error || null });
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
    await friendlyDelete(
      "DELETE FROM students WHERE id = $1 AND school_id = $2",
      [req.params.id, schoolId(req)],
      res, "/setup/students", "student"
    );
  })
);

// ===================== BULK STUDENT IMPORT (CSV) =====================
router.get(
  "/students/import",
  asyncHandler(async (req, res) => {
    const classes = await db.all("SELECT * FROM classes WHERE school_id = $1 ORDER BY name", [schoolId(req)]);
    res.render("setup/import", { title: "Bulk Import Students", classes, result: null, error: req.query.error || null });
  })
);

router.get("/students/import/template", (req, res) => {
  const csv =
    "full_name,admission_no,class,gender,guardian_name,guardian_email,guardian_phone\n" +
    "Amaka Johnson,BFA/25/001,JSS 1A,F,Mr. Johnson,parent@example.com,08030000001\n" +
    "David Okafor,BFA/25/002,JSS 1A,M,Mrs. Okafor,parent2@example.com,08030000002\n";
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="student_import_template.csv"');
  res.send(csv);
});

router.post(
  "/students/import",
  (req, res, next) => {
    uploadCsv.single("csv_file")(req, res, (err) => {
      if (err) return res.redirect("/setup/students/import?error=" + encodeURIComponent(err.message));
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const classes = await db.all("SELECT * FROM classes WHERE school_id = $1 ORDER BY name", [schoolId(req)]);

    if (!req.file) {
      return res.redirect("/setup/students/import?error=" + encodeURIComponent("Please choose a CSV file."));
    }

    let records;
    try {
      records = parse(req.file.buffer.toString("utf8"), {
        columns: (header) => header.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_")),
        skip_empty_lines: true,
        trim: true,
      });
    } catch (e) {
      return res.redirect("/setup/students/import?error=" + encodeURIComponent("Couldn't read that file as CSV: " + e.message));
    }

    const classByName = new Map(classes.map((c) => [c.name.trim().toLowerCase(), c]));
    // existing admission numbers in this school, so a re-upload doesn't create duplicates
    const existingAdmissionNos = new Set(
      (await db.all("SELECT admission_no FROM students WHERE school_id = $1 AND admission_no IS NOT NULL", [schoolId(req)]))
        .map((r) => (r.admission_no || "").trim().toLowerCase())
        .filter(Boolean)
    );

    const imported = [];
    const skipped = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2; // +1 for header row, +1 for 1-indexing
      const fullName = (row.full_name || row.name || "").trim();
      const className = (row.class || row.class_name || "").trim();
      const admissionNo = (row.admission_no || row.admission_number || "").trim();

      if (!fullName) {
        skipped.push({ row: rowNum, reason: "Missing student name" });
        continue;
      }
      if (!className) {
        skipped.push({ row: rowNum, reason: `"${fullName}" — missing class` });
        continue;
      }
      const klass = classByName.get(className.toLowerCase());
      if (!klass) {
        skipped.push({ row: rowNum, reason: `"${fullName}" — class "${className}" doesn't exist yet (create it first under Classes)` });
        continue;
      }
      if (admissionNo && existingAdmissionNos.has(admissionNo.toLowerCase())) {
        skipped.push({ row: rowNum, reason: `"${fullName}" — admission no. "${admissionNo}" already exists, skipped to avoid a duplicate` });
        continue;
      }

      await db.run(
        `INSERT INTO students (school_id, class_id, admission_no, full_name, gender, guardian_name, guardian_email, guardian_phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          schoolId(req), klass.id, admissionNo || null, fullName,
          (row.gender || "").trim() || null,
          (row.guardian_name || "").trim() || null,
          (row.guardian_email || "").trim() || null,
          (row.guardian_phone || "").trim() || null,
        ]
      );
      if (admissionNo) existingAdmissionNos.add(admissionNo.toLowerCase());
      imported.push({ row: rowNum, name: fullName, class: klass.name });
    }

    res.render("setup/import", {
      title: "Bulk Import Students",
      classes,
      error: null,
      result: { imported, skipped, total: records.length },
    });
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
    res.render("setup/teachers", { title: "Teachers", teachers, classes, subjects, assignments, error: req.query.error || null });
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
    await friendlyDelete(
      "DELETE FROM users WHERE id = $1 AND school_id = $2 AND role = 'teacher'",
      [req.params.id, schoolId(req)],
      res, "/setup/teachers", "teacher"
    );
  })
);

// ===================== BURSARS =====================
router.get(
  "/bursars",
  asyncHandler(async (req, res) => {
    const bursars = await db.all("SELECT * FROM users WHERE school_id = $1 AND role = 'bursar' ORDER BY name", [schoolId(req)]);
    res.render("setup/bursars", { title: "Bursars", bursars, error: req.query.error || null });
  })
);

router.post(
  "/bursars",
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    const existing = await db.get("SELECT id FROM users WHERE email = $1", [email.trim().toLowerCase()]);
    if (existing) return res.redirect("/setup/bursars?error=exists");
    const hash = bcrypt.hashSync(password || "bursar123", 10);
    await db.run("INSERT INTO users (school_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'bursar')", [
      schoolId(req), name.trim(), email.trim().toLowerCase(), hash,
    ]);
    res.redirect("/setup/bursars");
  })
);

router.delete(
  "/bursars/:id",
  asyncHandler(async (req, res) => {
    await friendlyDelete(
      "DELETE FROM users WHERE id = $1 AND school_id = $2 AND role = 'bursar'",
      [req.params.id, schoolId(req)],
      res, "/setup/bursars", "bursar"
    );
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

// ===================== SCORE COMPONENTS (CA1, CA2, Exam, Note, etc.) =====================
router.get(
  "/components",
  asyncHandler(async (req, res) => {
    const components = await db.all("SELECT * FROM score_components WHERE school_id = $1 ORDER BY sort_order, id", [schoolId(req)]);
    const total = components.reduce((sum, c) => sum + Number(c.max_score), 0);
    res.render("setup/components", { title: "Grading Components", components, total, error: req.query.error || null });
  })
);

router.post(
  "/components",
  asyncHandler(async (req, res) => {
    const { name, max_score } = req.body;
    if (!name || !max_score) return res.redirect("/setup/components?error=" + encodeURIComponent("Name and max score are required."));
    const maxCount = await db.get("SELECT COALESCE(MAX(sort_order), 0) as m FROM score_components WHERE school_id = $1", [schoolId(req)]);
    await db.run("INSERT INTO score_components (school_id, name, max_score, sort_order) VALUES ($1, $2, $3, $4)", [
      schoolId(req), name.trim(), parseFloat(max_score), Number(maxCount.m) + 1,
    ]);
    res.redirect("/setup/components");
  })
);

router.post(
  "/components/:id",
  asyncHandler(async (req, res) => {
    const { name, max_score } = req.body;
    await db.run("UPDATE score_components SET name = $1, max_score = $2 WHERE id = $3 AND school_id = $4", [
      name.trim(), parseFloat(max_score), req.params.id, schoolId(req),
    ]);
    res.redirect("/setup/components");
  })
);

router.delete(
  "/components/:id",
  asyncHandler(async (req, res) => {
    await friendlyDelete(
      "DELETE FROM score_components WHERE id = $1 AND school_id = $2",
      [req.params.id, schoolId(req)],
      res, "/setup/components", "grading component"
    );
  })
);

// ===================== CUSTOM REPORT CARD TRAITS (skills/behaviour ratings) =====================
router.get(
  "/traits",
  asyncHandler(async (req, res) => {
    const traits = await db.all("SELECT * FROM report_traits WHERE school_id = $1 ORDER BY category, sort_order, id", [schoolId(req)]);
    res.render("setup/traits", { title: "Report Card Sections", traits, error: req.query.error || null });
  })
);

router.post(
  "/traits",
  asyncHandler(async (req, res) => {
    const { name, category } = req.body;
    if (!name) return res.redirect("/setup/traits?error=" + encodeURIComponent("Name is required."));
    const maxCount = await db.get("SELECT COALESCE(MAX(sort_order), 0) as m FROM report_traits WHERE school_id = $1", [schoolId(req)]);
    await db.run("INSERT INTO report_traits (school_id, name, category, sort_order) VALUES ($1, $2, $3, $4)", [
      schoolId(req), name.trim(), category || "Other", Number(maxCount.m) + 1,
    ]);
    res.redirect("/setup/traits");
  })
);

router.delete(
  "/traits/:id",
  asyncHandler(async (req, res) => {
    await friendlyDelete(
      "DELETE FROM report_traits WHERE id = $1 AND school_id = $2",
      [req.params.id, schoolId(req)],
      res, "/setup/traits", "report card section"
    );
  })
);

module.exports = router;

const express = require("express");
const PDFDocument = require("pdfkit");
const db = require("../db");
const { requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { gradeFor } = require("../utils/grading");
const router = express.Router();

async function getActiveTerm(schoolId) {
  return db.get("SELECT * FROM terms WHERE school_id = $1 AND is_active = 1 ORDER BY id DESC LIMIT 1", [schoolId]);
}

async function computeStudentReport(schoolId, studentId, termId) {
  const student = await db.get("SELECT * FROM students WHERE id = $1 AND school_id = $2", [studentId, schoolId]);
  if (!student) return null;
  const klass = await db.get("SELECT * FROM classes WHERE id = $1", [student.class_id]);
  const school = await db.get("SELECT * FROM schools WHERE id = $1", [schoolId]);
  const term = await db.get("SELECT * FROM terms WHERE id = $1", [termId]);

  const subjects = await db.all(
    `SELECT DISTINCT s.* FROM subjects s
     JOIN teacher_assignments ta ON ta.subject_id = s.id
     WHERE ta.class_id = $1 ORDER BY s.name`,
    [student.class_id]
  );
  const components = await db.all("SELECT * FROM score_components WHERE school_id = $1 ORDER BY sort_order", [schoolId]);

  const subjectRows = [];
  for (const subj of subjects) {
    const compScores = [];
    for (const c of components) {
      const row = await db.get(
        "SELECT score FROM scores WHERE term_id = $1 AND student_id = $2 AND subject_id = $3 AND component_id = $4",
        [termId, studentId, subj.id, c.id]
      );
      compScores.push({ name: c.name, score: row ? Number(row.score) : null });
    }
    const total = compScores.reduce((sum, c) => sum + (c.score || 0), 0);
    subjectRows.push({ subjectName: subj.name, compScores, total });
  }

  const grandTotal = subjectRows.reduce((sum, r) => sum + r.total, 0);
  const average = subjectRows.length ? Math.round((grandTotal / subjectRows.length) * 100) / 100 : 0;

  // class position: need all students in the class
  const classmates = await db.all("SELECT id FROM students WHERE class_id = $1", [student.class_id]);
  const averages = [];
  for (const cm of classmates) {
    const rowTotals = [];
    for (const subj of subjects) {
      const r = await db.get("SELECT SUM(score) as t FROM scores WHERE term_id = $1 AND student_id = $2 AND subject_id = $3", [
        termId, cm.id, subj.id,
      ]);
      rowTotals.push(r && r.t !== null ? Number(r.t) : 0);
    }
    const avg = rowTotals.length ? rowTotals.reduce((a, b) => a + b, 0) / rowTotals.length : 0;
    averages.push({ studentId: cm.id, avg });
  }
  averages.sort((a, b) => b.avg - a.avg);
  const position = averages.findIndex((a) => a.studentId === Number(studentId)) + 1;
  const classSize = classmates.length;

  // attendance summary
  const attStatsRow = await db.get(
    `SELECT
       SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
       SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
       SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
       COUNT(*) as total
     FROM attendance WHERE term_id = $1 AND student_id = $2`,
    [termId, studentId]
  );
  const attStats = {
    present: Number(attStatsRow?.present || 0),
    absent: Number(attStatsRow?.absent || 0),
    late: Number(attStatsRow?.late || 0),
    total: Number(attStatsRow?.total || 0),
  };

  const commentRow = await db.get("SELECT * FROM comments WHERE term_id = $1 AND student_id = $2", [termId, studentId]);

  return { student, klass, school, term, subjectRows, grandTotal, average, position, classSize, attStats, commentRow };
}

router.get(
  "/:studentId",
  requireRole("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    if (!term) return res.render("error", { message: "No active term set." });
    const data = await computeStudentReport(schoolId, req.params.studentId, term.id);
    if (!data) return res.render("error", { message: "Student not found." });
    res.render("reportcard/view", { title: "Report Card", ...data, gradeFor });
  })
);

router.post(
  "/:studentId/comment",
  requireRole("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    if (!term) return res.redirect(`/reportcard/${req.params.studentId}`);
    const { teacher_comment, admin_comment } = req.body;
    const existing = await db.get("SELECT * FROM comments WHERE term_id = $1 AND student_id = $2", [term.id, req.params.studentId]);

    if (existing) {
      if (req.session.user.role === "teacher") {
        await db.run("UPDATE comments SET teacher_comment = $1 WHERE id = $2", [teacher_comment || "", existing.id]);
      } else {
        await db.run("UPDATE comments SET teacher_comment = $1, admin_comment = $2 WHERE id = $3", [
          teacher_comment || existing.teacher_comment || "", admin_comment || "", existing.id,
        ]);
      }
    } else {
      await db.run("INSERT INTO comments (school_id, term_id, student_id, teacher_comment, admin_comment) VALUES ($1, $2, $3, $4, $5)", [
        schoolId, term.id, req.params.studentId,
        teacher_comment || "",
        req.session.user.role === "school_admin" ? (admin_comment || "") : "",
      ]);
    }
    res.redirect(`/reportcard/${req.params.studentId}`);
  })
);

router.get(
  "/:studentId/pdf",
  requireRole("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    if (!term) return res.render("error", { message: "No active term set." });
    const data = await computeStudentReport(schoolId, req.params.studentId, term.id);
    if (!data) return res.render("error", { message: "Student not found." });

    const { student, klass, school, subjectRows, grandTotal, average, position, classSize, attStats, commentRow } = data;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${student.full_name.replace(/\s+/g, "_")}_ReportCard.pdf"`);

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    doc.pipe(res);

    if (school.logo_data && school.logo_mime && school.logo_mime !== "image/svg+xml") {
      try {
        const logoBuffer = Buffer.from(school.logo_data, "base64");
        doc.image(logoBuffer, doc.page.width / 2 - 40, doc.y, { fit: [80, 60], align: "center" });
        doc.moveDown(0.5);
      } catch (e) {
        // corrupt or unsupported image data - skip it rather than failing the whole PDF
      }
    }

    doc.fontSize(18).fillColor("#1E2761").text(school.name, { align: "center" });
    doc.fontSize(11).fillColor("#667085").text(`${term.term_name}, ${term.session_name} — Student Report Card`, { align: "center" });
    doc.moveDown(1);
    doc.strokeColor("#1E2761").lineWidth(2).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.8);

    doc.fontSize(11).fillColor("#1A1F36");
    doc.text(`Name: ${student.full_name}`, 40, doc.y);
    doc.text(`Class: ${klass.name}`, 320, doc.y - doc.currentLineHeight());
    doc.moveDown(0.3);
    doc.text(`Admission No: ${student.admission_no || "—"}`, 40);
    doc.text(`Position: ${position} of ${classSize}`, 320, doc.y - doc.currentLineHeight());
    doc.moveDown(1);

    const tableTop = doc.y;
    const colX = { subject: 40, comp: 260, total: 460 };
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("Subject", colX.subject, tableTop);
    doc.text("Components", colX.comp, tableTop);
    doc.text("Total", colX.total, tableTop);
    doc.moveDown(0.4);
    doc.strokeColor("#CCCCCC").lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.font("Helvetica").fontSize(10);

    subjectRows.forEach((row) => {
      doc.moveDown(0.4);
      const y = doc.y;
      doc.text(row.subjectName, colX.subject, y, { width: 210 });
      const compText = row.compScores.map((c) => `${c.name}: ${c.score ?? "-"}`).join("   ");
      doc.text(compText, colX.comp, y, { width: 190 });
      doc.text(String(row.total), colX.total, y);
    });

    doc.moveDown(1);
    doc.strokeColor("#1E2761").lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(11);
    doc.text(`Grand Total: ${grandTotal}      Average: ${average}      Grade: ${gradeFor(average).grade} (${gradeFor(average).remark})`, 40);

    doc.moveDown(1);
    doc.font("Helvetica-Bold").text("Attendance Summary", 40);
    doc.font("Helvetica").fontSize(10);
    doc.text(
      `Present: ${attStats.present || 0}   Absent: ${attStats.absent || 0}   Late: ${attStats.late || 0}   Total Days Recorded: ${attStats.total || 0}`,
      40
    );

    if (commentRow && (commentRow.teacher_comment || commentRow.admin_comment)) {
      doc.moveDown(1);
      if (commentRow.teacher_comment) {
        doc.font("Helvetica-Bold").text("Class Teacher's Comment:", 40, doc.y);
        doc.font("Helvetica").text(commentRow.teacher_comment, 40, doc.y, { width: 515 });
      }
      if (commentRow.admin_comment) {
        doc.moveDown(0.5);
        doc.font("Helvetica-Bold").text("Principal's Comment:", 40, doc.y);
        doc.font("Helvetica").text(commentRow.admin_comment, 40, doc.y, { width: 515 });
      }
    }

    doc.moveDown(2.5);
    doc.fontSize(10).fillColor("#667085");
    doc.text("_______________________", 60, doc.y);
    doc.text("_______________________", 340, doc.y - doc.currentLineHeight());
    doc.moveDown(0.2);
    doc.text("Class Teacher", 90);
    doc.text("Principal", 390, doc.y - doc.currentLineHeight());

    doc.end();
  })
);

module.exports = router;

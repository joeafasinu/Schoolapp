const express = require("express");
const ExcelJS = require("exceljs");
const db = require("../db");
const { requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { buildBroadsheet, gradeFor } = require("../utils/grading");
const router = express.Router();

async function getActiveTerm(schoolId) {
  return db.get("SELECT * FROM terms WHERE school_id = $1 AND is_active = 1 ORDER BY id DESC LIMIT 1", [schoolId]);
}

async function computeBroadsheetData(classId, termId) {
  const klass = await db.get("SELECT * FROM classes WHERE id = $1", [classId]);
  const students = await db.all("SELECT * FROM students WHERE class_id = $1 ORDER BY full_name", [classId]);
  const subjects = await db.all(
    `SELECT DISTINCT s.* FROM subjects s
     JOIN teacher_assignments ta ON ta.subject_id = s.id
     WHERE ta.class_id = $1 ORDER BY s.name`,
    [classId]
  );

  let rawScores = [];
  const studentIds = students.map((s) => s.id);
  if (studentIds.length) {
    rawScores = await db.all(
      `SELECT student_id, subject_id, SUM(score) as total
       FROM scores WHERE term_id = $1 AND student_id = ANY($2::int[])
       GROUP BY student_id, subject_id`,
      [termId, studentIds]
    );
  }

  const scoresByStudentSubject = new Map();
  rawScores.forEach((r) => scoresByStudentSubject.set(`${r.student_id}_${r.subject_id}`, Number(r.total)));

  const rows = buildBroadsheet(students, subjects, scoresByStudentSubject);
  return { klass, subjects, rows };
}

router.get(
  "/",
  requireRole("school_admin"),
  asyncHandler(async (req, res) => {
    const schoolId = req.session.user.school_id;
    const classes = await db.all("SELECT * FROM classes WHERE school_id = $1", [schoolId]);
    res.render("broadsheet/pick", { title: "Broadsheet", classes });
  })
);

router.get(
  "/:classId",
  requireRole("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    if (!term) return res.render("error", { message: "No active term set." });
    const { klass, subjects, rows } = await computeBroadsheetData(req.params.classId, term.id);
    res.render("broadsheet/view", { title: "Broadsheet", klass, subjects, rows, term, gradeFor });
  })
);

router.get(
  "/:classId/export",
  requireRole("school_admin"),
  asyncHandler(async (req, res) => {
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    if (!term) return res.render("error", { message: "No active term set." });
    const { klass, subjects, rows } = await computeBroadsheetData(req.params.classId, term.id);
    const school = await db.get("SELECT * FROM schools WHERE id = $1", [schoolId]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "SchoolApp";
    const sheet = workbook.addWorksheet(`${klass.name} Broadsheet`);

    sheet.mergeCells("A1", String.fromCharCode(65 + subjects.length + 3) + "1");
    sheet.getCell("A1").value = `${school.name} — ${klass.name} Broadsheet — ${term.term_name}, ${term.session_name}`;
    sheet.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1E2761" } };
    sheet.getCell("A1").alignment = { horizontal: "center" };

    const headerRowIdx = 3;
    const headers = ["S/N", "Student Name", ...subjects.map((s) => s.name), "Grand Total", "Average", "Position"];
    const headerRow = sheet.getRow(headerRowIdx);
    headers.forEach((h, i) => (headerRow.getCell(i + 1).value = h));
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E2761" } };
      cell.alignment = { horizontal: "center" };
      cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
    });

    rows.forEach((row, idx) => {
      const r = sheet.getRow(headerRowIdx + 1 + idx);
      r.getCell(1).value = idx + 1;
      r.getCell(2).value = row.fullName;
      row.subjectScores.forEach((ss, sIdx) => {
        r.getCell(3 + sIdx).value = ss.total ?? "-";
      });
      r.getCell(3 + subjects.length).value = row.grandTotal;
      r.getCell(4 + subjects.length).value = row.average;
      r.getCell(5 + subjects.length).value = row.position;
      r.eachCell((cell) => {
        cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
        cell.alignment = { horizontal: "center" };
      });
      r.getCell(2).alignment = { horizontal: "left" };
    });

    sheet.getColumn(2).width = 26;
    sheet.columns.forEach((col, i) => {
      if (i !== 1) col.width = Math.max(col.width || 10, 14);
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${klass.name.replace(/\s+/g, "_")}_Broadsheet_${term.term_name.replace(/\s+/g, "_")}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

module.exports = router;

// Simple configurable grade bands - schools can adjust later via settings (Phase 2)
const GRADE_BANDS = [
  { min: 70, grade: "A", remark: "Excellent" },
  { min: 60, grade: "B", remark: "Very Good" },
  { min: 50, grade: "C", remark: "Good" },
  { min: 45, grade: "D", remark: "Fair" },
  { min: 40, grade: "E", remark: "Pass" },
  { min: 0, grade: "F", remark: "Fail" },
];

function gradeFor(totalPercent) {
  return GRADE_BANDS.find((b) => totalPercent >= b.min);
}

/**
 * Computes a broadsheet-ready structure for a class + term.
 * students: [{id, full_name, admission_no}]
 * subjects: [{id, name}]
 * scoresByStudentSubject: Map key `${studentId}_${subjectId}` -> total score (already summed across components)
 * Returns rows sorted by rank, with grand total / average / position added.
 */
function buildBroadsheet(students, subjects, scoresByStudentSubject) {
  const rows = students.map((student) => {
    const subjectScores = subjects.map((subj) => {
      const key = `${student.id}_${subj.id}`;
      const total = scoresByStudentSubject.get(key) ?? null;
      return { subjectId: subj.id, subjectName: subj.name, total };
    });
    const validScores = subjectScores.filter((s) => s.total !== null);
    const grandTotal = validScores.reduce((sum, s) => sum + s.total, 0);
    const average = validScores.length ? grandTotal / validScores.length : 0;
    return {
      studentId: student.id,
      fullName: student.full_name,
      admissionNo: student.admission_no,
      subjectScores,
      grandTotal,
      average: Math.round(average * 100) / 100,
    };
  });

  // Rank by average, descending. Ties share the same position.
  const sorted = [...rows].sort((a, b) => b.average - a.average);
  let lastAverage = null;
  let lastPosition = 0;
  sorted.forEach((row, idx) => {
    if (row.average !== lastAverage) {
      lastPosition = idx + 1;
      lastAverage = row.average;
    }
    row.position = lastPosition;
  });

  // Return in original student order, each row now carrying its computed position
  const positionByStudent = new Map(sorted.map((r) => [r.studentId, r.position]));
  rows.forEach((r) => (r.position = positionByStudent.get(r.studentId)));

  return rows.sort((a, b) => a.position - b.position);
}

module.exports = { gradeFor, buildBroadsheet, GRADE_BANDS };

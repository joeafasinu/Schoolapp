const db = require("../db");

// Used only when a school hasn't configured its own grading scale yet - keeps
// every existing school working exactly as before with zero setup required.
const DEFAULT_GRADE_BANDS = [
  { min: 70, grade: "A", remark: "Excellent" },
  { min: 60, grade: "B", remark: "Very Good" },
  { min: 50, grade: "C", remark: "Good" },
  { min: 45, grade: "D", remark: "Fair" },
  { min: 40, grade: "E", remark: "Pass" },
  { min: 0, grade: "F", remark: "Fail" },
];

// Fetches a school's own grading scale, or the built-in default if they haven't set one up.
async function getGradeBands(schoolId) {
  const rows = await db.all(
    "SELECT min_score as min, grade, remark FROM grade_bands WHERE school_id = $1 ORDER BY min_score DESC",
    [schoolId]
  );
  if (rows.length === 0) return DEFAULT_GRADE_BANDS;
  return rows.map((r) => ({ min: Number(r.min), grade: r.grade, remark: r.remark || "" }));
}

// Bands must already be sorted descending by `min` (both getGradeBands and DEFAULT_GRADE_BANDS are).
function gradeFor(totalPercent, bands) {
  const list = bands || DEFAULT_GRADE_BANDS;
  return list.find((b) => totalPercent >= b.min) || list[list.length - 1];
}

async function getCommentBank(schoolId) {
  const rows = await db.all("SELECT * FROM comment_bank WHERE school_id = $1 ORDER BY grade, sort_order, id", [schoolId]);
  const byGrade = {};
  rows.forEach((r) => {
    if (!byGrade[r.grade]) byGrade[r.grade] = [];
    byGrade[r.grade].push(r.comment_text);
  });
  return byGrade;
}

/**
 * Computes a subject total for one student from raw component scores, honouring
 * weight groups if the school has configured them.
 *
 * componentScores: [{ componentId, name, groupName, maxScore, score }]
 * weightGroups: [{ groupName, weightPercent }] - empty array = old plain-sum behaviour
 *
 * Returns the total (out of 100 if weightGroups' percentages sum to 100, otherwise
 * out of whatever they sum to - the school's own responsibility to set them sensibly).
 */
function computeWeightedTotal(componentScores, weightGroups) {
  const hasGroups = weightGroups && weightGroups.length > 0 && componentScores.some((c) => c.groupName);
  if (!hasGroups) {
    // Original behaviour: plain sum of raw scores. Identical to every school's current results.
    return componentScores.reduce((sum, c) => sum + (c.score || 0), 0);
  }

  const weightByGroup = new Map(weightGroups.map((g) => [g.groupName, Number(g.weightPercent)]));
  const groups = new Map(); // groupName -> { rawSum, maxSum }
  const ungrouped = { rawSum: 0, maxSum: 0 };

  componentScores.forEach((c) => {
    if (c.groupName && weightByGroup.has(c.groupName)) {
      const g = groups.get(c.groupName) || { rawSum: 0, maxSum: 0 };
      g.rawSum += c.score || 0;
      g.maxSum += c.maxScore || 0;
      groups.set(c.groupName, g);
    } else {
      // A component with no group, or a group the school hasn't assigned a weight to,
      // is simply added at face value alongside the weighted groups.
      ungrouped.rawSum += c.score || 0;
      ungrouped.maxSum += c.maxScore || 0;
    }
  });

  let total = ungrouped.rawSum;
  groups.forEach((g, groupName) => {
    const weight = weightByGroup.get(groupName) || 0;
    const pct = g.maxSum > 0 ? (g.rawSum / g.maxSum) * weight : 0;
    total += pct;
  });

  return Math.round(total * 100) / 100;
}

async function getWeightGroups(schoolId) {
  const rows = await db.all("SELECT group_name, weight_percent FROM weight_groups WHERE school_id = $1", [schoolId]);
  return rows.map((r) => ({ groupName: r.group_name, weightPercent: Number(r.weight_percent) }));
}

/**
 * Computes a broadsheet-ready structure for a class + term.
 * students: [{id, full_name, admission_no}]
 * subjects: [{id, name}]
 * scoresByStudentSubject: Map key `${studentId}_${subjectId}` -> total score (already computed per-subject)
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

  const positionByStudent = new Map(sorted.map((r) => [r.studentId, r.position]));
  rows.forEach((r) => (r.position = positionByStudent.get(r.studentId)));

  return rows.sort((a, b) => a.position - b.position);
}

module.exports = {
  gradeFor, buildBroadsheet, DEFAULT_GRADE_BANDS,
  getGradeBands, getCommentBank, computeWeightedTotal, getWeightGroups,
};

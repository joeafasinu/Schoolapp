const db = require("../db");

// One row per student, with expected fee, total paid, balance and status for a given term.
async function getFeeSummary(schoolId, termId) {
  const rows = await db.all(
    `SELECT st.id, st.full_name, st.admission_no, st.guardian_name, st.guardian_phone,
            c.id as class_id, c.name as class_name,
            COALESCE(fs.amount, 0) as expected,
            fs.due_date,
            COALESCE((SELECT SUM(fp.amount) FROM fee_payments fp WHERE fp.term_id = $1 AND fp.student_id = st.id), 0) as paid
     FROM students st
     JOIN classes c ON c.id = st.class_id
     LEFT JOIN fee_structures fs ON fs.term_id = $1 AND fs.class_id = st.class_id
     WHERE st.school_id = $2
     ORDER BY c.name, st.full_name`,
    [termId, schoolId]
  );

  const today = new Date();
  return rows.map((r) => {
    const expected = Number(r.expected);
    const paid = Number(r.paid);
    const balance = Math.max(0, expected - paid);
    let status = "Unpaid";
    if (expected === 0) status = "No Fee Set";
    else if (balance <= 0) status = "Paid";
    else if (paid > 0) status = "Partial";
    const overdue = balance > 0 && r.due_date && new Date(r.due_date) < today;
    return {
      studentId: r.id,
      fullName: r.full_name,
      admissionNo: r.admission_no,
      guardianName: r.guardian_name,
      guardianPhone: r.guardian_phone,
      className: r.class_name,
      classId: r.class_id,
      expected,
      paid,
      balance,
      status,
      dueDate: r.due_date,
      overdue,
    };
  });
}

function summarizeFeeRows(rows) {
  return {
    totalExpected: rows.reduce((s, r) => s + r.expected, 0),
    totalCollected: rows.reduce((s, r) => s + r.paid, 0),
    totalOutstanding: rows.reduce((s, r) => s + r.balance, 0),
    overdueCount: rows.filter((r) => r.overdue).length,
    paidCount: rows.filter((r) => r.status === "Paid").length,
    partialCount: rows.filter((r) => r.status === "Partial").length,
    unpaidCount: rows.filter((r) => r.status === "Unpaid").length,
  };
}

function formatNaira(amount) {
  return "\u20A6" + Number(amount).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Best-effort normalisation of a Nigerian phone number into the international format wa.me needs.
// e.g. "08031234567" -> "2348031234567", "+2348031234567" -> "2348031234567"
function toWhatsAppNumber(phone) {
  if (!phone) return null;
  let digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("0")) digits = "234" + digits.slice(1);
  else if (!digits.startsWith("234")) digits = "234" + digits;
  return digits;
}

module.exports = { getFeeSummary, summarizeFeeRows, formatNaira, toWhatsAppNumber };

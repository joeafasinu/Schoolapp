const express = require("express");
const PDFDocument = require("pdfkit");
const db = require("../db");
const { requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { getFeeSummary, summarizeFeeRows, formatNaira, toWhatsAppNumber } = require("../utils/fees");
const router = express.Router();

router.use(requireRole("school_admin", "bursar"));

async function getActiveTerm(schoolId) {
  return db.get("SELECT * FROM terms WHERE school_id = $1 AND is_active = 1 ORDER BY id DESC LIMIT 1", [schoolId]);
}

// ===================== FEE STRUCTURE (set expected amount per class) =====================
router.get(
  "/structure",
  asyncHandler(async (req, res) => {
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    if (!term) return res.render("error", { message: "No active term set. Ask the school admin to start one." });
    const classes = await db.all(
      `SELECT c.*, fs.amount, fs.due_date FROM classes c
       LEFT JOIN fee_structures fs ON fs.class_id = c.id AND fs.term_id = $1
       WHERE c.school_id = $2 ORDER BY c.name`,
      [term.id, schoolId]
    );
    res.render("fees/structure", { title: "Fee Structure", classes, term, saved: req.query.saved || null });
  })
);

router.post(
  "/structure",
  asyncHandler(async (req, res) => {
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    if (!term) return res.redirect("/fees/structure");
    const classes = await db.all("SELECT id FROM classes WHERE school_id = $1", [schoolId]);
    for (const c of classes) {
      const amount = req.body[`amount_${c.id}`];
      const dueDate = req.body[`due_date_${c.id}`];
      if (amount === undefined || amount === "") continue;
      await db.run(
        `INSERT INTO fee_structures (school_id, term_id, class_id, amount, due_date) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (term_id, class_id) DO UPDATE SET amount = EXCLUDED.amount, due_date = EXCLUDED.due_date`,
        [schoolId, term.id, c.id, parseFloat(amount) || 0, dueDate || null]
      );
    }
    res.redirect("/fees/structure?saved=1");
  })
);

// ===================== STUDENT FEE DETAIL + PAYMENT RECORDING =====================
router.get(
  "/student/:studentId",
  asyncHandler(async (req, res) => {
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    if (!term) return res.render("error", { message: "No active term set." });

    const student = await db.get("SELECT * FROM students WHERE id = $1 AND school_id = $2", [req.params.studentId, schoolId]);
    if (!student) return res.render("error", { message: "Student not found." });

    const rows = await getFeeSummary(schoolId, term.id);
    const summary = rows.find((r) => r.studentId === Number(req.params.studentId));
    const payments = await db.all(
      "SELECT * FROM fee_payments WHERE term_id = $1 AND student_id = $2 ORDER BY payment_date DESC, id DESC",
      [term.id, req.params.studentId]
    );

    res.render("fees/student", {
      title: "Student Fees",
      student, summary, payments, term,
      formatNaira, toWhatsAppNumber,
      justPaid: req.query.paid || null,
    });
  })
);

router.post(
  "/student/:studentId/payment",
  asyncHandler(async (req, res) => {
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    if (!term) return res.redirect(`/fees/student/${req.params.studentId}`);
    const { amount, method, notes, payment_date } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.redirect(`/fees/student/${req.params.studentId}?error=1`);

    const paymentId = await db.insert(
      `INSERT INTO fee_payments (school_id, term_id, student_id, amount, payment_date, method, notes, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [schoolId, term.id, req.params.studentId, amt, payment_date || new Date().toISOString().slice(0, 10), method || null, notes || null, req.session.user.id]
    );

    res.redirect(`/fees/student/${req.params.studentId}?paid=${paymentId}`);
  })
);

// ===================== RECEIPT (printable HTML + PDF + WhatsApp text) =====================
async function computeReceiptData(schoolId, studentId, termId, paymentId) {
  const student = await db.get("SELECT * FROM students WHERE id = $1 AND school_id = $2", [studentId, schoolId]);
  if (!student) return null;
  const school = await db.get("SELECT * FROM schools WHERE id = $1", [schoolId]);
  const term = await db.get("SELECT * FROM terms WHERE id = $1", [termId]);
  const klass = await db.get("SELECT * FROM classes WHERE id = $1", [student.class_id]);
  const payment = await db.get("SELECT * FROM fee_payments WHERE id = $1 AND student_id = $2", [paymentId, studentId]);
  if (!payment) return null;

  const rows = await getFeeSummary(schoolId, termId);
  const summary = rows.find((r) => r.studentId === Number(studentId));

  return { student, school, term, klass, payment, summary };
}

router.get(
  "/student/:studentId/receipt/:paymentId",
  asyncHandler(async (req, res) => {
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    const data = await computeReceiptData(schoolId, req.params.studentId, term.id, req.params.paymentId);
    if (!data) return res.render("error", { message: "Receipt not found." });
    res.render("fees/receipt", { title: "Payment Receipt", ...data, formatNaira, toWhatsAppNumber });
  })
);

router.get(
  "/student/:studentId/receipt/:paymentId/pdf",
  asyncHandler(async (req, res) => {
    const schoolId = req.session.user.school_id;
    const term = await getActiveTerm(schoolId);
    const data = await computeReceiptData(schoolId, req.params.studentId, term.id, req.params.paymentId);
    if (!data) return res.render("error", { message: "Receipt not found." });
    const { student, school, klass, payment, summary } = data;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Receipt_${student.full_name.replace(/\s+/g, "_")}_${payment.id}.pdf"`);

    const doc = new PDFDocument({ margin: 40, size: "A5" });
    doc.pipe(res);

    if (school.logo_data && school.logo_mime && school.logo_mime !== "image/svg+xml") {
      try {
        doc.image(Buffer.from(school.logo_data, "base64"), doc.page.width / 2 - 30, doc.y, { fit: [60, 45], align: "center" });
        doc.moveDown(0.4);
      } catch (e) {}
    }

    doc.fontSize(16).fillColor("#1E2761").text(school.name, { align: "center" });
    doc.fontSize(10).fillColor("#667085").text("Payment Receipt", { align: "center" });
    doc.moveDown(1);
    doc.strokeColor("#1E2761").lineWidth(1.5).moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
    doc.moveDown(0.8);

    doc.fontSize(10).fillColor("#1A1F36");
    doc.text(`Receipt No: RCT-${school.id}-${payment.id}`);
    doc.text(`Date: ${new Date(payment.payment_date).toLocaleDateString()}`);
    doc.moveDown(0.5);
    doc.text(`Student: ${student.full_name}`);
    doc.text(`Class: ${klass.name}`);
    doc.moveDown(0.8);

    doc.font("Helvetica-Bold").fontSize(13).text(`Amount Paid: ${formatNaira(payment.amount)}`);
    doc.font("Helvetica").fontSize(10).moveDown(0.5);
    doc.text(`Total Paid This Term: ${formatNaira(summary.paid)}`);
    doc.text(`Term Fee: ${formatNaira(summary.expected)}`);
    doc.font("Helvetica-Bold").fillColor(summary.balance > 0 ? "#A8433A" : "#2C7A57");
    doc.text(`Balance: ${formatNaira(summary.balance)}`);

    doc.moveDown(2);
    doc.fontSize(9).fillColor("#667085").text("Thank you for your payment.", { align: "center" });

    doc.end();
  })
);

module.exports = router;

require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("./index");

function hash(pw) {
  return bcrypt.hashSync(pw, 10);
}

async function main() {
  await db.initSchema();

  const existingSchool = await db.get("SELECT id FROM schools WHERE name = $1", ["Brightfield Academy (Demo)"]);
  if (existingSchool) {
    console.log("Demo data already seeded. Skipping. (Drop the schools table / use a fresh database to reseed.)");
    process.exit(0);
  }

  const schoolId = await db.insert("INSERT INTO schools (name, address) VALUES ($1, $2) RETURNING id", [
    "Brightfield Academy (Demo)",
    "12 Freedom Way, Lagos",
  ]);

  // Platform admin (you, the SaaS owner) - not tied to a school
  await db.run("INSERT INTO users (school_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)", [
    null, "Platform Owner", "owner@platform.com", hash("owner123"), "platform_admin",
  ]);

  // School admin
  await db.insert(
    "INSERT INTO users (school_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'school_admin') RETURNING id",
    [schoolId, "Mrs. Adaeze Okoro", "admin@brightfield.demo", hash("admin123")]
  );

  // Teachers
  const teacherMath = await db.insert(
    "INSERT INTO users (school_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'teacher') RETURNING id",
    [schoolId, "Mr. Chinedu Eze", "chinedu@brightfield.demo", hash("teacher123")]
  );
  const teacherEng = await db.insert(
    "INSERT INTO users (school_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'teacher') RETURNING id",
    [schoolId, "Mrs. Funke Adebayo", "funke@brightfield.demo", hash("teacher123")]
  );
  const teacherSci = await db.insert(
    "INSERT INTO users (school_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'teacher') RETURNING id",
    [schoolId, "Mr. Tunde Bakare", "tunde@brightfield.demo", hash("teacher123")]
  );

  // Term
  const termId = await db.insert(
    "INSERT INTO terms (school_id, session_name, term_name, is_active, total_school_days) VALUES ($1, $2, $3, 1, $4) RETURNING id",
    [schoolId, "2025/2026", "First Term", 60]
  );

  // Score components
  const compCA1 = await db.insert(
    "INSERT INTO score_components (school_id, name, max_score, sort_order) VALUES ($1, $2, $3, $4) RETURNING id",
    [schoolId, "CA1", 20, 1]
  );
  const compCA2 = await db.insert(
    "INSERT INTO score_components (school_id, name, max_score, sort_order) VALUES ($1, $2, $3, $4) RETURNING id",
    [schoolId, "CA2", 20, 2]
  );
  const compExam = await db.insert(
    "INSERT INTO score_components (school_id, name, max_score, sort_order) VALUES ($1, $2, $3, $4) RETURNING id",
    [schoolId, "Exam", 60, 3]
  );

  // Class
  const classId = await db.insert(
    "INSERT INTO classes (school_id, name, form_teacher_id) VALUES ($1, $2, $3) RETURNING id",
    [schoolId, "JSS 1A", teacherMath]
  );

  // Subjects
  const subMath = await db.insert("INSERT INTO subjects (school_id, name) VALUES ($1, $2) RETURNING id", [schoolId, "Mathematics"]);
  const subEng = await db.insert("INSERT INTO subjects (school_id, name) VALUES ($1, $2) RETURNING id", [schoolId, "English Language"]);
  const subSci = await db.insert("INSERT INTO subjects (school_id, name) VALUES ($1, $2) RETURNING id", [schoolId, "Basic Science"]);

  // Teacher assignments
  await db.run("INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id) VALUES ($1, $2, $3, $4)", [schoolId, teacherMath, classId, subMath]);
  await db.run("INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id) VALUES ($1, $2, $3, $4)", [schoolId, teacherEng, classId, subEng]);
  await db.run("INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id) VALUES ($1, $2, $3, $4)", [schoolId, teacherSci, classId, subSci]);

  // Students
  const students = [
    ["BFA/25/001", "Amaka Johnson", "F", "Mr. Johnson", "parent1@example.com", "08030000001"],
    ["BFA/25/002", "David Okafor", "M", "Mrs. Okafor", "parent2@example.com", "08030000002"],
    ["BFA/25/003", "Blessing Ibrahim", "F", "Mr. Ibrahim", "parent3@example.com", "08030000003"],
    ["BFA/25/004", "Emeka Nwosu", "M", "Mrs. Nwosu", "parent4@example.com", "08030000004"],
    ["BFA/25/005", "Zainab Suleiman", "F", "Mr. Suleiman", "parent5@example.com", "08030000005"],
  ];
  const studentIds = [];
  for (const s of students) {
    const id = await db.insert(
      "INSERT INTO students (school_id, class_id, admission_no, full_name, gender, guardian_name, guardian_email, guardian_phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [schoolId, classId, s[0], s[1], s[2], s[3], s[4], s[5]]
    );
    studentIds.push(id);
  }

  // Sample scores
  const subjectsAndTeachers = [
    [subMath, teacherMath],
    [subEng, teacherEng],
    [subSci, teacherSci],
  ];
  let seedCounter = 0;
  for (const sid of studentIds) {
    for (const [subId, tId] of subjectsAndTeachers) {
      seedCounter++;
      const ca1 = 12 + (seedCounter % 8);
      const ca2 = 10 + ((seedCounter * 3) % 10);
      const exam = 30 + ((seedCounter * 7) % 30);
      await db.run(
        "INSERT INTO scores (school_id, term_id, student_id, subject_id, component_id, score, entered_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [schoolId, termId, sid, subId, compCA1, ca1, tId]
      );
      await db.run(
        "INSERT INTO scores (school_id, term_id, student_id, subject_id, component_id, score, entered_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [schoolId, termId, sid, subId, compCA2, ca2, tId]
      );
      await db.run(
        "INSERT INTO scores (school_id, term_id, student_id, subject_id, component_id, score, entered_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [schoolId, termId, sid, subId, compExam, exam, tId]
      );
    }
  }

  // Sample attendance for the last 10 days
  const today = new Date();
  for (let idx = 0; idx < studentIds.length; idx++) {
    const sid = studentIds[idx];
    for (let d = 0; d < 10; d++) {
      const date = new Date(today);
      date.setDate(date.getDate() - d);
      const dateStr = date.toISOString().slice(0, 10);
      const status = (idx + d) % 6 === 0 ? "absent" : "present";
      await db.run(
        "INSERT INTO attendance (school_id, term_id, class_id, student_id, date, status, marked_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [schoolId, termId, classId, sid, dateStr, status, teacherMath]
      );
    }
  }

  console.log("=================================================");
  console.log(" Demo data seeded successfully!");
  console.log("=================================================");
  console.log(" Platform Admin login:  owner@platform.com / owner123");
  console.log(" School Admin login:    admin@brightfield.demo / admin123");
  console.log(" Teacher (Maths) login: chinedu@brightfield.demo / teacher123");
  console.log(" Teacher (English):     funke@brightfield.demo / teacher123");
  console.log(" Teacher (Science):     tunde@brightfield.demo / teacher123");
  console.log("=================================================");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

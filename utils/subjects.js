const db = require("../db");

/**
 * The subjects a class actually takes:
 *  - class belongs to a normal level  -> every subject of that level (inherited, entered once)
 *  - class belongs to a streamed level -> only the subjects this arm picked from the level's pool
 *  - class has no level (legacy)       -> subjects that have a teacher assigned (the original behaviour)
 */
async function getClassSubjects(classId) {
  const klass = await db.get(
    "SELECT c.id, c.level_id, l.is_streamed FROM classes c LEFT JOIN class_levels l ON l.id = c.level_id WHERE c.id = $1",
    [classId]
  );
  if (!klass) return [];
  if (klass.level_id) {
    if (klass.is_streamed) {
      return db.all(
        "SELECT s.* FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id WHERE cs.class_id = $1 ORDER BY s.name",
        [classId]
      );
    }
    return db.all(
      "SELECT s.* FROM level_subjects ls JOIN subjects s ON s.id = ls.subject_id WHERE ls.level_id = $1 ORDER BY s.name",
      [klass.level_id]
    );
  }
  return db.all(
    `SELECT DISTINCT s.* FROM subjects s
     JOIN teacher_assignments ta ON ta.subject_id = s.id
     WHERE ta.class_id = $1 ORDER BY s.name`,
    [classId]
  );
}

module.exports = { getClassSubjects };

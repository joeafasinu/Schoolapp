const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const { slugify } = require("../utils/slug");

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/schoolapp";
const useSSL = process.env.PGSSL === "true"; // Render's external DB URLs need SSL; internal ones don't

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

// Helper: returns array of rows
async function all(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

// Helper: returns first row or null
async function get(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows[0] || null;
}

// Helper: INSERT ... RETURNING id -> returns the new id
async function insert(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows[0] ? res.rows[0].id : null;
}

// Helper: UPDATE/DELETE -> returns affected row count
async function run(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rowCount;
}

// Gives every school a unique URL slug (used for its branded login page). Safe to run on every boot.
async function backfillSlugs() {
  const rows = await all("SELECT id, name FROM schools WHERE slug IS NULL ORDER BY id");
  for (const r of rows) {
    const base = slugify(r.name);
    let slug = base;
    let n = 2;
    while (await get("SELECT 1 AS x FROM schools WHERE slug = $1", [slug])) slug = `${base}-${n++}`;
    await run("UPDATE schools SET slug = $1 WHERE id = $2", [slug, r.id]);
  }
}

async function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  await backfillSlugs();
}

module.exports = { pool, all, get, insert, run, initSchema };

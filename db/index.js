const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

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

async function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
}

module.exports = { pool, all, get, insert, run, initSchema };

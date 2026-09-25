const db = require("../db");

/**
 * Runs a DELETE query and, if it fails because other records still reference the row
 * (Postgres foreign-key violation, code 23503), redirects back with a clear, human
 * message instead of letting the raw database error bubble up to a generic 500 page.
 *
 * @param {string} sql - the DELETE ... query
 * @param {Array} params - query params
 * @param {object} res - Express response
 * @param {string} redirectUrl - where to send the user back to either way
 * @param {string} entityLabel - human name for the thing being deleted, e.g. "class"
 */
async function friendlyDelete(sql, params, res, redirectUrl, entityLabel) {
  try {
    await db.run(sql, params);
    res.redirect(redirectUrl);
  } catch (err) {
    if (err.code === "23503") {
      const msg = `Can't delete this ${entityLabel} — it's still linked to other records (e.g. assignments, scores, attendance, or payments). Remove those first, or ask an admin for help.`;
      const sep = redirectUrl.includes("?") ? "&" : "?";
      return res.redirect(redirectUrl + sep + "error=" + encodeURIComponent(msg));
    }
    throw err; // anything else is unexpected - let the central error handler deal with it
  }
}

module.exports = { friendlyDelete };

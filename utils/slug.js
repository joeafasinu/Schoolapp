// Pure helper (no db import) so db/index.js can use it without a circular dependency.
function slugify(name) {
  const s = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return s || "school";
}

// dbApi = the db module (passed in to keep this file dependency-free)
async function uniqueSlug(name, dbApi) {
  const base = slugify(name);
  let slug = base;
  let n = 2;
  while (await dbApi.get("SELECT 1 AS x FROM schools WHERE slug = $1", [slug])) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

module.exports = { slugify, uniqueSlug };

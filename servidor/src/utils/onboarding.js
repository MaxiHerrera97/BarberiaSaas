function normalizeSlug(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isValidSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length >= 3 && slug.length <= 80;
}

function sanitizeName(value, maxLen = 120) {
  return String(value || "").trim().slice(0, maxLen);
}

module.exports = {
  isValidSlug,
  normalizeSlug,
  sanitizeName,
};

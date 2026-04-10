const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeSlug, isValidSlug, sanitizeName } = require("../src/utils/onboarding");

test("normalizeSlug normalizes unsafe values", () => {
  assert.equal(normalizeSlug("  Barberia Centro!! "), "barberia-centro");
  assert.equal(normalizeSlug("A__B"), "a-b");
});

test("isValidSlug accepts only expected pattern", () => {
  assert.equal(isValidSlug("abc"), true);
  assert.equal(isValidSlug("barberia-centro"), true);
  assert.equal(isValidSlug("ab"), false);
  assert.equal(isValidSlug("barberia_centro"), false);
});

test("sanitizeName trims and limits length", () => {
  assert.equal(sanitizeName("  Juan  "), "Juan");
  assert.equal(sanitizeName("x".repeat(200), 10).length, 10);
});

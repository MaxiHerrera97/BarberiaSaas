const test = require("node:test");
const assert = require("node:assert/strict");

const { securityHeaders } = require("../src/middleware/security");

test("securityHeaders sets hardening headers", () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
  const headers = {};
  const res = {
    setHeader(name, value) {
      headers[name] = value;
    },
  };

  let nextCalled = false;
  securityHeaders({}, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
});

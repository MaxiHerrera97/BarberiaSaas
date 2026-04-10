const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const { auth } = require("../src/middleware/auth");

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("auth allows token when tenant matches", () => {
  const token = jwt.sign(
    { userId: 1, tenantId: 10, role: "admin", barberId: null, name: "Admin" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  const req = {
    headers: { authorization: `Bearer ${token}` },
    tenant: { id: 10 },
  };
  const res = createRes();
  let nextCalled = false;

  auth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(req.user.tenantId, 10);
});

test("auth blocks token when tenant does not match", () => {
  const token = jwt.sign(
    { userId: 1, tenantId: 10, role: "admin", barberId: null, name: "Admin" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  const req = {
    headers: { authorization: `Bearer ${token}` },
    tenant: { id: 11 },
  };
  const res = createRes();
  let nextCalled = false;

  auth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /tenant/i);
});

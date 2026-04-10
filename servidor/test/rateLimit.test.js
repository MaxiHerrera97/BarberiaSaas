const test = require("node:test");
const assert = require("node:assert/strict");

const { createRateLimiter } = require("../src/middleware/rateLimit");

function createMockRes() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
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

test("rate limiter blocks after max attempts", () => {
  const limiter = createRateLimiter({
    windowMs: 60_000,
    maxAttempts: 2,
    keyFn: (req) => req.ip,
  });

  let nextCalls = 0;
  const req = { ip: "127.0.0.1" };

  limiter(req, createMockRes(), () => {
    nextCalls += 1;
  });
  limiter(req, createMockRes(), () => {
    nextCalls += 1;
  });

  const blockedRes = createMockRes();
  limiter(req, blockedRes, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 2);
  assert.equal(blockedRes.statusCode, 429);
  assert.match(blockedRes.body.error, /Demasiados intentos/i);
  assert.ok(blockedRes.headers["Retry-After"]);
});

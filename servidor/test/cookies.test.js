const test = require("node:test");
const assert = require("node:assert/strict");

const { parseCookies, serializeCookie } = require("../src/utils/cookies");

test("parseCookies reads cookie header into an object", () => {
  assert.deepEqual(parseCookies("foo=bar; hello=world"), {
    foo: "bar",
    hello: "world",
  });
});

test("serializeCookie adds secure attributes", () => {
  const header = serializeCookie("session", "abc", {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    path: "/",
    maxAge: 60,
  });

  assert.match(header, /^session=abc;/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=None/);
  assert.match(header, /Max-Age=60/);
});

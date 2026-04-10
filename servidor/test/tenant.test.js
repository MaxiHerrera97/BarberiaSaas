const test = require("node:test");
const assert = require("node:assert/strict");

const { getTenantSlugFromHost } = require("../src/utils/tenant");

test("getTenantSlugFromHost returns null for localhost and ip", () => {
  assert.equal(getTenantSlugFromHost("localhost:4000"), null);
  assert.equal(getTenantSlugFromHost("127.0.0.1:4000"), null);
});

test("getTenantSlugFromHost reads first subdomain", () => {
  assert.equal(
    getTenantSlugFromHost("acme.tuestilo.app", { baseDomains: ["tuestilo.app"] }),
    "acme"
  );
  assert.equal(
    getTenantSlugFromHost("www.tuestilo.app", { baseDomains: ["tuestilo.app"] }),
    null
  );
});

test("getTenantSlugFromHost supports tenant.localhost", () => {
  assert.equal(getTenantSlugFromHost("barberia-centro.localhost:5173"), "barberia-centro");
});

test("getTenantSlugFromHost respects reserved slugs", () => {
  assert.equal(
    getTenantSlugFromHost("api.app.tuestilo.com.ar", { reservedSlugs: ["api", "app"] }),
    null
  );
});

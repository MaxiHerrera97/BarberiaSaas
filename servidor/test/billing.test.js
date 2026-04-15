const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getCurrentBillingContext,
  isValidBillingMonth,
  normalizePaymentMethod,
} = require("../src/utils/billing");

test("billing context: dentro de ventana de pago (dia 3)", () => {
  const now = new Date("2026-04-03T15:00:00.000Z");
  const ctx = getCurrentBillingContext("America/Argentina/Buenos_Aires", now);
  assert.equal(ctx.billingMonth, "2026-04");
  assert.equal(ctx.isPaymentWindow, true);
  assert.equal(ctx.isPastDue, false);
});

test("billing context: fuera de termino (dia 6)", () => {
  const now = new Date("2026-04-06T15:00:00.000Z");
  const ctx = getCurrentBillingContext("America/Argentina/Buenos_Aires", now);
  assert.equal(ctx.billingMonth, "2026-04");
  assert.equal(ctx.isPaymentWindow, false);
  assert.equal(ctx.isPastDue, true);
});

test("validacion de mes YYYY-MM", () => {
  assert.equal(isValidBillingMonth("2026-01"), true);
  assert.equal(isValidBillingMonth("2026-13"), false);
  assert.equal(isValidBillingMonth("26-01"), false);
});

test("normalizacion de metodo de pago", () => {
  assert.equal(normalizePaymentMethod("mp"), "mercado_pago");
  assert.equal(normalizePaymentMethod("transferencia_bancaria"), "transferencia");
  assert.equal(normalizePaymentMethod("cash"), "efectivo");
  assert.equal(normalizePaymentMethod("otro"), "");
});


const BILLING_MONTHLY_FEE_ARS = 30000;
const BILLING_WINDOW_START_DAY = 1;
const BILLING_WINDOW_END_DAY = 5;
const PAYMENT_METHODS = ["transferencia", "mercado_pago", "efectivo"];

function getDatePartsInTimezone(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const year = Number(byType.year);
  const month = Number(byType.month);
  const day = Number(byType.day);
  return { year, month, day };
}

function getCurrentBillingContext(timezone, now = new Date()) {
  const { year, month, day } = getDatePartsInTimezone(now, timezone);
  const billingMonth = `${year}-${String(month).padStart(2, "0")}`;
  return {
    billingMonth,
    dayOfMonth: day,
    isPaymentWindow: day >= BILLING_WINDOW_START_DAY && day <= BILLING_WINDOW_END_DAY,
    isPastDue: day > BILLING_WINDOW_END_DAY,
  };
}

function isValidBillingMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || "").trim());
}

function normalizePaymentMethod(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();

  if (raw === "transferencia" || raw === "transferencia_bancaria" || raw === "transfer") {
    return "transferencia";
  }
  if (raw === "mercado_pago" || raw === "mercadopago" || raw === "mp") {
    return "mercado_pago";
  }
  if (raw === "efectivo" || raw === "cash") {
    return "efectivo";
  }
  return "";
}

module.exports = {
  BILLING_MONTHLY_FEE_ARS,
  BILLING_WINDOW_START_DAY,
  BILLING_WINDOW_END_DAY,
  PAYMENT_METHODS,
  getCurrentBillingContext,
  isValidBillingMonth,
  normalizePaymentMethod,
};

const express = require("express");
const { pool } = require("../db");
const { getServerConfig } = require("../config");
const { getTenantSlugFromHost } = require("../utils/tenant");
const {
  BILLING_MONTHLY_FEE_ARS,
  BILLING_WINDOW_END_DAY,
  PAYMENT_METHODS,
  getCurrentBillingContext,
  isValidBillingMonth,
} = require("../utils/billing");

const router = express.Router();
const serverConfig = getServerConfig();

function readHost(req) {
  const forwardedHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  return forwardedHost || String(req.headers.host || "");
}

function readOrigin(req) {
  const incomingOrigin = String(req.headers.origin || "").trim();
  if (incomingOrigin) return incomingOrigin;

  const protocol = String(req.headers["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();
  const host = readHost(req);
  if (!host) return "";
  return `${protocol}://${host}`;
}

async function resolveTenant(req) {
  const headerSlug = String(req.headers[serverConfig.tenantHeaderName] || "")
    .trim()
    .toLowerCase();
  const hostSlug = getTenantSlugFromHost(readHost(req), {
    reservedSlugs: serverConfig.tenantReservedSlugs,
    baseDomains: serverConfig.tenantBaseDomains,
  });
  const tenantSlug = headerSlug || hostSlug || serverConfig.defaultTenantSlug;

  const [rows] = await pool.query(
    `SELECT id, slug, name, status, timezone
     FROM tenants
     WHERE slug = :slug
     LIMIT 1`,
    { slug: tenantSlug }
  );

  return rows[0] || null;
}

function parseExternalReference(value) {
  const ref = String(value || "").trim();
  // Formato: tb|<tenantId>|<billingMonth>|<timestamp>
  const match = ref.match(/^tb\|(\d+)\|(\d{4}-(0[1-9]|1[0-2]))\|(\d{10,})$/);
  if (!match) return null;
  return {
    tenantId: Number(match[1]),
    billingMonth: match[2],
  };
}

async function recordApprovedPayment({
  tenantId,
  billingMonth,
  amountArs,
  paymentId,
  paymentMethod = "mercado_pago",
  payerEmail = "",
}) {
  const safeAmount = Number.isFinite(Number(amountArs)) && Number(amountArs) > 0
    ? Math.round(Number(amountArs))
    : BILLING_MONTHLY_FEE_ARS;
  const notes = [
    `Pago online aprobado por Mercado Pago`,
    paymentId ? `payment_id:${paymentId}` : "",
    payerEmail ? `payer:${String(payerEmail).slice(0, 80)}` : "",
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 255);

  await pool.query(
    `INSERT INTO tenant_billing_payments
     (tenant_id, billing_month, amount_ars, payment_method, notes, recorded_by)
     VALUES
     (:tenantId, :billingMonth, :amountArs, :paymentMethod, :notes, :recordedBy)
     ON DUPLICATE KEY UPDATE
       amount_ars = VALUES(amount_ars),
       payment_method = VALUES(payment_method),
       notes = VALUES(notes),
       recorded_by = VALUES(recorded_by),
       paid_at = CURRENT_TIMESTAMP`,
    {
      tenantId,
      billingMonth,
      amountArs: safeAmount,
      paymentMethod,
      notes,
      recordedBy: "mercadopago:webhook",
    }
  );

  // Si estaba inactivo por mora y luego paga, se reactiva.
  await pool.query(
    `UPDATE tenants
     SET status = 'active'
     WHERE id = :tenantId
       AND status = 'inactive'`,
    { tenantId }
  );
}

router.get("/public/status", async (req, res) => {
  try {
    const tenant = await resolveTenant(req);
    if (!tenant) return res.status(404).json({ error: "Tenant no existe" });

    const billingCtx = getCurrentBillingContext(tenant.timezone);
    const [[payment]] = await pool.query(
      `SELECT id, billing_month, amount_ars, payment_method, paid_at
       FROM tenant_billing_payments
       WHERE tenant_id = :tenantId
         AND billing_month = :billingMonth
       LIMIT 1`,
      { tenantId: tenant.id, billingMonth: billingCtx.billingMonth }
    );

    return res.json({
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
      },
      billing: {
        billingMonth: billingCtx.billingMonth,
        dueDay: BILLING_WINDOW_END_DAY,
        monthlyFeeArs: BILLING_MONTHLY_FEE_ARS,
        acceptedMethods: PAYMENT_METHODS,
        currentMonthPaid: !!payment,
        suspendedByPayment: billingCtx.isPastDue && !payment,
        isPastDue: billingCtx.isPastDue,
        isPaymentWindow: billingCtx.isPaymentWindow,
      },
      payment: payment || null,
      onlinePayment: {
        enabled: !!serverConfig.mpAccessToken,
        provider: "mercado_pago",
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error consultando estado de billing" });
  }
});

router.post("/public/mercadopago/checkout", async (req, res) => {
  try {
    if (!serverConfig.mpAccessToken) {
      return res.status(503).json({
        error: "Pago online deshabilitado. Falta configurar MP_ACCESS_TOKEN.",
      });
    }

    const tenant = await resolveTenant(req);
    if (!tenant) return res.status(404).json({ error: "Tenant no existe" });

    const billingCtx = getCurrentBillingContext(tenant.timezone);
    const requestedMonth = String(req.body?.billingMonth || billingCtx.billingMonth).trim();
    if (!isValidBillingMonth(requestedMonth)) {
      return res.status(400).json({ error: "billingMonth inválido (YYYY-MM)" });
    }

    const [[existingPayment]] = await pool.query(
      `SELECT id, paid_at, amount_ars, payment_method
       FROM tenant_billing_payments
       WHERE tenant_id = :tenantId
         AND billing_month = :billingMonth
       LIMIT 1`,
      { tenantId: tenant.id, billingMonth: requestedMonth }
    );
    if (existingPayment) {
      return res.json({
        ok: true,
        alreadyPaid: true,
        billingMonth: requestedMonth,
        payment: existingPayment,
      });
    }

    const origin = readOrigin(req);
    const backBase = origin || `https://${tenant.slug}.${serverConfig.tenantBaseDomains?.[0] || "localhost"}`;
    const publicApiBase = String(serverConfig.publicApiBaseUrl || "").trim();
    if (!publicApiBase) {
      return res.status(503).json({
        error: "Falta PUBLIC_API_BASE_URL para confirmar pagos online.",
      });
    }

    const externalReference = `tb|${tenant.id}|${requestedMonth}|${Date.now()}`;
    const amountArs = BILLING_MONTHLY_FEE_ARS;
    const title = `Suscripcion mensual ${tenant.name} (${requestedMonth})`;

    const preferencePayload = {
      external_reference: externalReference,
      items: [
        {
          id: `suscripcion-${requestedMonth}`,
          title,
          quantity: 1,
          unit_price: amountArs,
          currency_id: "ARS",
        },
      ],
      metadata: {
        tenant_id: tenant.id,
        tenant_slug: tenant.slug,
        billing_month: requestedMonth,
      },
      back_urls: {
        success: `${backBase}/login?billing=success&month=${requestedMonth}`,
        pending: `${backBase}/login?billing=pending&month=${requestedMonth}`,
        failure: `${backBase}/login?billing=failure&month=${requestedMonth}`,
      },
      auto_return: "approved",
      notification_url: `${publicApiBase}/billing/webhook/mercadopago`,
      statement_descriptor: "TUESTILO SAAS",
    };

    const mpResp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serverConfig.mpAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(preferencePayload),
    });
    const mpData = await mpResp.json().catch(() => null);
    if (!mpResp.ok || !mpData?.id || !mpData?.init_point) {
      const detail = mpData?.message || mpData?.error || `HTTP ${mpResp.status}`;
      return res.status(502).json({ error: `Error creando checkout de Mercado Pago: ${detail}` });
    }

    const isTestToken = String(serverConfig.mpAccessToken || "")
      .trim()
      .toUpperCase()
      .startsWith("TEST-");
    const checkoutUrl = isTestToken
      ? (mpData.sandbox_init_point || mpData.init_point || "")
      : (mpData.init_point || mpData.sandbox_init_point || "");

    if (!checkoutUrl) {
      return res.status(502).json({
        error: "Mercado Pago no devolvió un link de checkout válido",
      });
    }

    return res.json({
      ok: true,
      provider: "mercado_pago",
      billingMonth: requestedMonth,
      preferenceId: mpData.id,
      checkoutUrl,
      sandboxCheckoutUrl: mpData.sandbox_init_point || "",
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error generando checkout online" });
  }
});

router.all("/webhook/mercadopago", async (req, res) => {
  try {
    if (!serverConfig.mpAccessToken) {
      return res.status(200).json({ ok: true, skipped: "mp_disabled" });
    }

    const type = String(req.query?.type || req.query?.topic || req.body?.type || "").trim();
    const dataId =
      req.query?.["data.id"] ||
      req.query?.id ||
      req.body?.data?.id ||
      req.body?.id ||
      "";
    const paymentId = String(dataId || "").trim();

    // Aceptamos notificaciones de otros tipos para evitar reintentos.
    if (!paymentId || (type && type !== "payment")) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const paymentResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        Authorization: `Bearer ${serverConfig.mpAccessToken}`,
      },
    });
    const payment = await paymentResp.json().catch(() => null);
    if (!paymentResp.ok || !payment?.id) {
      return res.status(200).json({ ok: true, ignored: "payment_not_found" });
    }

    if (String(payment.status || "").toLowerCase() !== "approved") {
      return res.status(200).json({ ok: true, ignored: `status_${payment.status || "unknown"}` });
    }

    const metadataTenantId = Number(payment?.metadata?.tenant_id || 0);
    const metadataMonth = String(payment?.metadata?.billing_month || "").trim();
    let tenantId = metadataTenantId;
    let billingMonth = metadataMonth;

    if (!tenantId || !isValidBillingMonth(billingMonth)) {
      const parsed = parseExternalReference(payment.external_reference);
      tenantId = parsed?.tenantId || 0;
      billingMonth = parsed?.billingMonth || "";
    }

    if (!tenantId || !isValidBillingMonth(billingMonth)) {
      return res.status(200).json({ ok: true, ignored: "missing_reference" });
    }

    await recordApprovedPayment({
      tenantId,
      billingMonth,
      amountArs: Number(payment.transaction_amount || BILLING_MONTHLY_FEE_ARS),
      paymentId: String(payment.id),
      payerEmail: String(payment?.payer?.email || ""),
      paymentMethod: "mercado_pago",
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    // Devolvemos 200 para no generar loop de reintentos infinitos por errores temporales.
    return res.status(200).json({ ok: true, ignored: "internal_error" });
  }
});

module.exports = router;

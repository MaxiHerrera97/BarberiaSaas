const express = require("express");
const { pool } = require("../db");
const { getServerConfig } = require("../config");
const { getTenantSlugFromHost } = require("../utils/tenant");
const {
  BILLING_MONTHLY_FEE_ARS,
  BILLING_WINDOW_END_DAY,
  PAYMENT_METHODS,
  getCurrentBillingContext,
  getBillingMonthFromDate,
  isValidBillingMonth,
} = require("../utils/billing");

const router = express.Router();
const serverConfig = getServerConfig();

function isSubscriptionManualOnly(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "paused" || normalized === "cancelled";
}

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
    `SELECT id, slug, name, status, timezone,
            trial_active, trial_starts_at, trial_ends_at,
            CASE
              WHEN trial_active = 1
               AND trial_ends_at IS NOT NULL
               AND UTC_TIMESTAMP() <= trial_ends_at
              THEN 1
              ELSE 0
            END AS trial_in_window,
            CASE
              WHEN trial_active = 1
               AND trial_ends_at IS NOT NULL
               AND UTC_TIMESTAMP() > trial_ends_at
              THEN 1
              ELSE 0
            END AS trial_expired
     FROM tenants
     WHERE slug = :slug
     LIMIT 1`,
    { slug: tenantSlug }
  );

  return rows[0] || null;
}

async function getTenantSubscription(tenantId) {
  try {
    const [[row]] = await pool.query(
      `SELECT mp_subscription_id, mp_subscription_status, mp_subscription_started_at, mp_subscription_updated_at
       FROM tenants
       WHERE id = :tenantId
       LIMIT 1`,
      { tenantId }
    );
    return {
      enabled: true,
      id: row?.mp_subscription_id || "",
      status: row?.mp_subscription_status || "",
      startedAt: row?.mp_subscription_started_at || null,
      updatedAt: row?.mp_subscription_updated_at || null,
      manualOnly: isSubscriptionManualOnly(row?.mp_subscription_status),
      manualOnlyReason: isSubscriptionManualOnly(row?.mp_subscription_status)
        ? "subscription_paused_or_cancelled"
        : "",
      active:
        !!row?.mp_subscription_id &&
        ["authorized", "active", "pending"].includes(
          String(row?.mp_subscription_status || "").toLowerCase()
        ),
    };
  } catch (e) {
    if (e?.code === "ER_BAD_FIELD_ERROR") {
    return {
      enabled: false,
      id: "",
      status: "",
      startedAt: null,
      updatedAt: null,
      manualOnly: false,
      active: false,
    };
    }
    throw e;
  }
}

async function resolveTenantById(tenantId) {
  const [rows] = await pool.query(
    `SELECT id, slug, name, status, timezone
     FROM tenants
     WHERE id = :tenantId
     LIMIT 1`,
    { tenantId }
  );
  return rows[0] || null;
}

function parseExternalReference(value) {
  const ref = String(value || "").trim();
  // checkout único: tb|<tenantId>|<billingMonth>|<timestamp>
  const monthBased = ref.match(/^tb\|(\d+)\|(\d{4}-(0[1-9]|1[0-2]))\|(\d{10,})$/);
  if (monthBased) {
    return {
      kind: "checkout",
      tenantId: Number(monthBased[1]),
      billingMonth: monthBased[2],
    };
  }

  // suscripción: tbs|<tenantId>|<timestamp>
  const subscriptionBased = ref.match(/^tbs\|(\d+)\|(\d{10,})$/);
  if (subscriptionBased) {
    return {
      kind: "subscription",
      tenantId: Number(subscriptionBased[1]),
      billingMonth: "",
    };
  }

  return null;
}

async function fetchMpJson(path, accessToken, { method = "GET", body = null, attempts = 2 } = {}) {
  let lastError = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const resp = await fetch(`https://api.mercadopago.com${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await resp.json().catch(() => null);
      if (resp.ok) return { ok: true, status: resp.status, data };

      const isRetryable = resp.status >= 500;
      if (!isRetryable || i === attempts) {
        return { ok: false, status: resp.status, data };
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * i));
    } catch (e) {
      lastError = e;
      if (i === attempts) throw e;
      await new Promise((resolve) => setTimeout(resolve, 250 * i));
    }
  }
  if (lastError) throw lastError;
  return { ok: false, status: 500, data: null };
}

async function insertWebhookEvent({
  provider,
  eventKey,
  eventType,
  eventId,
  payload,
}) {
  try {
    const [result] = await pool.query(
      `INSERT INTO tenant_billing_webhook_events
       (provider, event_key, event_type, event_id, status, attempts_count, payload_json)
       VALUES
       (:provider, :eventKey, :eventType, :eventId, 'processing', 1, :payloadJson)`,
      {
        provider,
        eventKey,
        eventType,
        eventId,
        payloadJson: payload ? JSON.stringify(payload).slice(0, 65535) : null,
      }
    );
    return { inserted: true, id: result.insertId };
  } catch (e) {
    if (e?.code === "ER_DUP_ENTRY") return { inserted: false, duplicate: true };
    if (e?.code === "ER_NO_SUCH_TABLE") return { inserted: true, missingTable: true };
    throw e;
  }
}

async function completeWebhookEvent(eventKey, status, errorMessage = "") {
  try {
    await pool.query(
      `UPDATE tenant_billing_webhook_events
       SET status = :status,
           processed_at = IF(:status = 'processed', CURRENT_TIMESTAMP, processed_at),
           last_error = :lastError
       WHERE event_key = :eventKey`,
      {
        status,
        eventKey,
        lastError: String(errorMessage || "").slice(0, 255) || null,
      }
    );
  } catch (e) {
    if (e?.code !== "ER_NO_SUCH_TABLE") throw e;
  }
}

async function recordApprovedPayment({
  tenantId,
  billingMonth,
  amountArs,
  paymentId,
  paymentMethod = "mercado_pago",
  payerEmail = "",
  source = "mercadopago:webhook",
}) {
  const safeAmount =
    Number.isFinite(Number(amountArs)) && Number(amountArs) > 0
      ? Math.round(Number(amountArs))
      : BILLING_MONTHLY_FEE_ARS;
  const notes = [
    "Pago online aprobado por Mercado Pago",
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
      recordedBy: source,
    }
  );

  await pool.query(
    `UPDATE tenants
     SET status = 'active'
     WHERE id = :tenantId
       AND status = 'inactive'`,
    { tenantId }
  );
}

async function updateTenantSubscription(tenantId, { subscriptionId, status, startedAt = null }) {
  try {
    await pool.query(
      `UPDATE tenants
       SET mp_subscription_id = :subscriptionId,
           mp_subscription_status = :subscriptionStatus,
           mp_subscription_started_at = COALESCE(:startedAt, mp_subscription_started_at, UTC_TIMESTAMP()),
           mp_subscription_updated_at = UTC_TIMESTAMP()
       WHERE id = :tenantId`,
      {
        tenantId,
        subscriptionId: String(subscriptionId || "").slice(0, 80) || null,
        subscriptionStatus: String(status || "").slice(0, 40) || null,
        startedAt: startedAt || null,
      }
    );
  } catch (e) {
    if (e?.code !== "ER_BAD_FIELD_ERROR") throw e;
  }
}

async function createMonthlyCheckout({
  tenant,
  requestedMonth,
  backBase,
  publicApiBase,
}) {
  const [[existingPayment]] = await pool.query(
    `SELECT id, paid_at, amount_ars, payment_method
     FROM tenant_billing_payments
     WHERE tenant_id = :tenantId
       AND billing_month = :billingMonth
     LIMIT 1`,
    { tenantId: tenant.id, billingMonth: requestedMonth }
  );
  if (existingPayment) {
    return {
      ok: true,
      mode: "checkout",
      alreadyPaid: true,
      billingMonth: requestedMonth,
      payment: existingPayment,
    };
  }

  const externalReference = `tb|${tenant.id}|${requestedMonth}|${Date.now()}`;
  const preferencePayload = {
    external_reference: externalReference,
    items: [
      {
        id: `suscripcion-${requestedMonth}`,
        title: `Suscripción mensual ${tenant.name} (${requestedMonth})`,
        quantity: 1,
        unit_price: BILLING_MONTHLY_FEE_ARS,
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

  const mpResp = await fetchMpJson("/checkout/preferences", serverConfig.mpAccessToken, {
    method: "POST",
    body: preferencePayload,
    attempts: 2,
  });
  if (!mpResp.ok || !mpResp.data?.id || !mpResp.data?.init_point) {
    const detail = mpResp.data?.message || mpResp.data?.error || `HTTP ${mpResp.status || 502}`;
    throw new Error(`Error creando checkout de Mercado Pago: ${detail}`);
  }

  const isTestToken = String(serverConfig.mpAccessToken || "")
    .trim()
    .toUpperCase()
    .startsWith("TEST-");
  const checkoutUrl = isTestToken
    ? mpResp.data.sandbox_init_point || mpResp.data.init_point || ""
    : mpResp.data.init_point || mpResp.data.sandbox_init_point || "";

  if (!checkoutUrl) {
    throw new Error("Mercado Pago no devolvió un link de checkout válido");
  }

  return {
    ok: true,
    provider: "mercado_pago",
    mode: "checkout",
    billingMonth: requestedMonth,
    preferenceId: mpResp.data.id,
    checkoutUrl,
    sandboxCheckoutUrl: mpResp.data.sandbox_init_point || "",
  };
}

router.get("/public/status", async (req, res) => {
  try {
    const tenant = await resolveTenant(req);
    if (!tenant) return res.status(404).json({ error: "Tenant no existe" });

    const subscription = await getTenantSubscription(tenant.id);
    const billingCtx = getCurrentBillingContext(tenant.timezone);
    const trialInWindow = Number(tenant.trial_in_window || 0) === 1;
    const trialExpired = Number(tenant.trial_expired || 0) === 1;
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
        suspendedByPayment: !trialInWindow && billingCtx.isPastDue && !payment,
        isPastDue: billingCtx.isPastDue,
        isPaymentWindow: billingCtx.isPaymentWindow,
      },
      trial: {
        enabled: Number(tenant.trial_active || 0) === 1,
        inWindow: trialInWindow,
        expired: trialExpired,
        startedAt: tenant.trial_starts_at || null,
        endsAt: tenant.trial_ends_at || null,
      },
      payment: payment || null,
      subscription,
      onlinePayment: {
        enabled: !!serverConfig.mpAccessToken,
        provider: "mercado_pago",
        mode:
          serverConfig.mpBillingMode === "subscription" && !subscription.manualOnly
            ? "subscription"
            : "checkout",
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error consultando estado de billing" });
  }
});

async function startMercadoPago(req, res) {
  try {
    if (!serverConfig.mpAccessToken) {
      return res.status(503).json({
        error: "Pago online deshabilitado. Falta configurar MP_ACCESS_TOKEN.",
      });
    }

    const tenant = await resolveTenant(req);
    if (!tenant) return res.status(404).json({ error: "Tenant no existe" });

    const forcedMode = String(req.body?.forceMode || "").trim().toLowerCase();
    const mode =
      forcedMode === "subscription" || forcedMode === "checkout"
        ? forcedMode
        : serverConfig.mpBillingMode === "subscription"
        ? "subscription"
        : "checkout";
    const origin = readOrigin(req);
    const backBase =
      origin || `https://${tenant.slug}.${serverConfig.tenantBaseDomains?.[0] || "localhost"}`;
    const publicApiBase = String(serverConfig.publicApiBaseUrl || "").trim();
    if (!publicApiBase) {
      return res.status(503).json({
        error: "Falta PUBLIC_API_BASE_URL para confirmar pagos online.",
      });
    }

    const currentSubscription = await getTenantSubscription(tenant.id);
    if (mode === "subscription" && currentSubscription.manualOnly) {
      const fallbackMonth = getCurrentBillingContext(tenant.timezone).billingMonth;
      const checkout = await createMonthlyCheckout({
        tenant,
        requestedMonth: fallbackMonth,
        backBase,
        publicApiBase,
      });
      return res.json({
        ...checkout,
        fallbackFromSubscription: true,
        fallbackReason: "subscription_paused_or_cancelled",
      });
    }

    if (mode === "subscription") {
      const externalReference = `tbs|${tenant.id}|${Date.now()}`;
      const preapprovalPayload = {
        reason: `Suscripción mensual ${tenant.name}`,
        external_reference: externalReference,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: BILLING_MONTHLY_FEE_ARS,
          currency_id: "ARS",
        },
        back_url: `${backBase}/login?billing=subscription`,
        status: "pending",
        notification_url: `${publicApiBase}/billing/webhook/mercadopago`,
      };

      const mpResp = await fetchMpJson("/preapproval", serverConfig.mpAccessToken, {
        method: "POST",
        body: preapprovalPayload,
        attempts: 2,
      });
      if (!mpResp.ok || !mpResp.data?.id || !mpResp.data?.init_point) {
        const fallbackMonth = getCurrentBillingContext(tenant.timezone).billingMonth;
        const checkout = await createMonthlyCheckout({
          tenant,
          requestedMonth: fallbackMonth,
          backBase,
          publicApiBase,
        });
        return res.json({
          ...checkout,
          fallbackFromSubscription: true,
        });
      }

      await updateTenantSubscription(tenant.id, {
        subscriptionId: String(mpResp.data.id),
        status: String(mpResp.data.status || "pending"),
      });

      return res.json({
        ok: true,
        provider: "mercado_pago",
        mode: "subscription",
        subscriptionId: String(mpResp.data.id),
        checkoutUrl: mpResp.data.init_point,
      });
    }

    const billingCtx = getCurrentBillingContext(tenant.timezone);
    const requestedMonth = String(req.body?.billingMonth || billingCtx.billingMonth).trim();
    if (!isValidBillingMonth(requestedMonth)) {
      return res.status(400).json({ error: "billingMonth inválido (YYYY-MM)" });
    }

    const checkout = await createMonthlyCheckout({
      tenant,
      requestedMonth,
      backBase,
      publicApiBase,
    });
    return res.json(checkout);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error iniciando pago online" });
  }
}

router.post("/public/mercadopago/start", startMercadoPago);

router.post("/public/mercadopago/checkout", async (req, res) => {
  req.body = { ...(req.body || {}), forceMode: "checkout" };
  return startMercadoPago(req, res);
});

router.all("/webhook/mercadopago", async (req, res) => {
  const type = String(req.query?.type || req.query?.topic || req.body?.type || "").trim();
  const dataId = String(
    req.query?.["data.id"] ||
      req.query?.id ||
      req.body?.data?.id ||
      req.body?.id ||
      ""
  ).trim();

  const eventType = type || "unknown";
  const eventId = dataId || "unknown";
  const eventKey = `mercado_pago:${eventType}:${eventId}`;

  try {
    if (!serverConfig.mpAccessToken) {
      return res.status(200).json({ ok: true, skipped: "mp_disabled" });
    }

    const tracked = await insertWebhookEvent({
      provider: "mercado_pago",
      eventKey,
      eventType,
      eventId,
      payload: {
        query: req.query || {},
        body: req.body || {},
      },
    });
    if (tracked.duplicate) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    if (!dataId || (type && type !== "payment" && type !== "preapproval")) {
      await completeWebhookEvent(eventKey, "ignored", "type_or_id_invalid");
      return res.status(200).json({ ok: true, ignored: true });
    }

    if (type === "preapproval") {
      const mpResp = await fetchMpJson(`/preapproval/${dataId}`, serverConfig.mpAccessToken, {
        attempts: 3,
      });
      if (!mpResp.ok || !mpResp.data?.id) {
        const detail = mpResp.data?.message || mpResp.data?.error || "preapproval_not_found";
        await completeWebhookEvent(eventKey, "failed", detail);
        return res.status(500).json({ ok: false, retry: true });
      }

      const preapproval = mpResp.data;
      const parsed = parseExternalReference(preapproval.external_reference);
      const tenantId = parsed?.tenantId || Number(preapproval?.metadata?.tenant_id || 0);
      if (!tenantId) {
        await completeWebhookEvent(eventKey, "ignored", "tenant_not_found_in_reference");
        return res.status(200).json({ ok: true, ignored: true });
      }

      await updateTenantSubscription(tenantId, {
        subscriptionId: String(preapproval.id),
        status: String(preapproval.status || "pending"),
        startedAt: preapproval.date_created || null,
      });
      await completeWebhookEvent(eventKey, "processed");
      return res.status(200).json({ ok: true });
    }

    const mpResp = await fetchMpJson(`/v1/payments/${dataId}`, serverConfig.mpAccessToken, {
      attempts: 3,
    });
    if (!mpResp.ok || !mpResp.data?.id) {
      const detail = mpResp.data?.message || mpResp.data?.error || "payment_not_found";
      await completeWebhookEvent(eventKey, "failed", detail);
      return res.status(500).json({ ok: false, retry: true });
    }

    const payment = mpResp.data;
    if (String(payment.status || "").toLowerCase() !== "approved") {
      await completeWebhookEvent(eventKey, "ignored", `status_${payment.status || "unknown"}`);
      return res.status(200).json({ ok: true, ignored: true });
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

    if (!tenantId && payment?.preapproval_id) {
      const [rows] = await pool.query(
        `SELECT id, timezone
         FROM tenants
         WHERE mp_subscription_id = :subscriptionId
         LIMIT 1`,
        { subscriptionId: String(payment.preapproval_id) }
      );
      tenantId = Number(rows?.[0]?.id || 0);
      if (!billingMonth && tenantId) {
        const tenantBySub = await resolveTenantById(tenantId);
        billingMonth = getBillingMonthFromDate(
          payment?.date_approved || payment?.date_created || new Date(),
          tenantBySub?.timezone || "America/Argentina/Buenos_Aires"
        );
      }
      if (tenantId) {
        await updateTenantSubscription(tenantId, {
          subscriptionId: String(payment.preapproval_id),
          status: "authorized",
        });
      }
    }

    if (!tenantId) {
      await completeWebhookEvent(eventKey, "ignored", "missing_tenant_reference");
      return res.status(200).json({ ok: true, ignored: true });
    }

    if (!isValidBillingMonth(billingMonth)) {
      const tenant = await resolveTenantById(tenantId);
      billingMonth = getBillingMonthFromDate(
        payment?.date_approved || payment?.date_created || new Date(),
        tenant?.timezone || "America/Argentina/Buenos_Aires"
      );
    }

    await recordApprovedPayment({
      tenantId,
      billingMonth,
      amountArs: Number(payment.transaction_amount || BILLING_MONTHLY_FEE_ARS),
      paymentId: String(payment.id),
      payerEmail: String(payment?.payer?.email || ""),
      paymentMethod: "mercado_pago",
      source: "mercadopago:webhook",
    });

    await completeWebhookEvent(eventKey, "processed");
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    await completeWebhookEvent(eventKey, "failed", e?.message || "internal_error");
    return res.status(500).json({ ok: false, retry: true });
  }
});

module.exports = router;

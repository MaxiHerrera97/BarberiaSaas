const { pool } = require("../db");
const { getServerConfig } = require("../config");
const { getTenantSlugFromHost } = require("../utils/tenant");
const {
  BILLING_MONTHLY_FEE_ARS,
  BILLING_WINDOW_END_DAY,
  PAYMENT_METHODS,
  getCurrentBillingContext,
} = require("../utils/billing");

const serverConfig = getServerConfig();

function isSubscriptionManualOnly(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "paused" || normalized === "cancelled";
}

function isSubscriptionActive(subscriptionId, status) {
  const normalized = String(status || "").trim().toLowerCase();
  return (
    !!String(subscriptionId || "").trim() &&
    ["authorized", "active", "pending"].includes(normalized)
  );
}

function extractRequestHost(req) {
  const forwardedHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  return forwardedHost || String(req.headers.host || "");
}

async function resolveTenant(req, res, next) {
  try {
    const headerSlug = String(req.headers[serverConfig.tenantHeaderName] || "")
      .trim()
      .toLowerCase();
    const hostSlug = getTenantSlugFromHost(extractRequestHost(req), {
      reservedSlugs: serverConfig.tenantReservedSlugs,
      baseDomains: serverConfig.tenantBaseDomains,
    });
    const tenantSlug = headerSlug || hostSlug || serverConfig.defaultTenantSlug;

    const [rows] = await pool.query(
      `SELECT id, slug, name, plan, status, timezone, multi_branch_enabled,
              booking_payment_required, booking_payment_provider, booking_mp_access_token, booking_mp_collector_id,
              mp_subscription_id,
              mp_subscription_status,
              trial_active, trial_starts_at, trial_ends_at,
              CASE
                WHEN trial_active = 1
                 AND trial_ends_at IS NOT NULL
                 AND UTC_TIMESTAMP() > trial_ends_at
                THEN 1
                ELSE 0
              END AS trial_expired,
              CASE
                WHEN trial_active = 1
                 AND trial_ends_at IS NOT NULL
                 AND UTC_TIMESTAMP() <= trial_ends_at
                THEN 1
                ELSE 0
              END AS trial_in_window
       FROM tenants
       WHERE slug = :slug
       LIMIT 1`,
      { slug: tenantSlug }
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Tenant no existe" });
    }

    const tenant = rows[0];
    const manualOnlyBySubscription = isSubscriptionManualOnly(tenant.mp_subscription_status);
    const activeSubscription = isSubscriptionActive(
      tenant.mp_subscription_id,
      tenant.mp_subscription_status
    );
    const trialExpired = Number(tenant.trial_expired || 0) === 1;
    const trialInWindow = Number(tenant.trial_in_window || 0) === 1;

    const billingContext = getCurrentBillingContext(tenant.timezone);
    let currentMonthPaid = false;

    async function loadCurrentMonthPayment() {
      try {
        const [rowsPaid] = await pool.query(
          `SELECT id
           FROM tenant_billing_payments
           WHERE tenant_id = :tenantId
             AND billing_month = :billingMonth
           LIMIT 1`,
          { tenantId: tenant.id, billingMonth: billingContext.billingMonth }
        );
        return rowsPaid;
      } catch (e) {
        if (e?.code === "ER_NO_SUCH_TABLE") {
          console.warn(
            "[billing] Falta tabla tenant_billing_payments. Ejecuta la migración 005_tenant_billing_payments.sql"
          );
          return [{ id: 0 }];
        }
        throw e;
      }
    }

    if (trialExpired || (!trialInWindow && billingContext.isPastDue)) {
      const paymentRows = await loadCurrentMonthPayment();
      currentMonthPaid = activeSubscription || paymentRows.length > 0;
    }

    if (tenant.status === "active" && trialExpired && !currentMonthPaid) {
      await pool.query(
        `UPDATE tenants
         SET status = 'inactive'
         WHERE id = :tenantId
           AND status = 'active'`,
        { tenantId: tenant.id }
      );
      tenant.status = "inactive";
    }

    // Si estaba inactivo por fin de prueba pero ya tiene el mes pago, se reactiva automáticamente.
    if (tenant.status !== "active" && trialExpired && currentMonthPaid) {
      await pool.query(
        `UPDATE tenants
         SET status = 'active'
         WHERE id = :tenantId
           AND status <> 'active'`,
        { tenantId: tenant.id }
      );
      tenant.status = "active";
    }

    if (tenant.status !== "active") {
      if (!trialExpired) {
        return res.status(403).json({
          code: "TENANT_SUSPENDED",
          error: "Aplicacion suspendida, comunicate con tu administrador para dar de alta.",
        });
      }

      return res.status(403).json({
        code: "TENANT_TRIAL_EXPIRED",
        error:
          "Tu período de prueba finalizó. Realiza el pago para continuar o comunicate con tu administrador.",
        trial: {
          enabled: Number(tenant.trial_active || 0) === 1,
          expired: trialExpired,
          startedAt: tenant.trial_starts_at || null,
          endsAt: tenant.trial_ends_at || null,
        },
        billing: {
          monthlyFeeArs: BILLING_MONTHLY_FEE_ARS,
          dueDay: BILLING_WINDOW_END_DAY,
          acceptedMethods: PAYMENT_METHODS,
          canPayOnline: !!serverConfig.mpAccessToken,
          onlinePaymentMode:
            serverConfig.mpBillingMode === "subscription" && !manualOnlyBySubscription
              ? "subscription"
              : "checkout",
        },
      });
    }

    // Si la prueba gratuita sigue vigente, no se suspende por mora.
    if (!trialInWindow && billingContext.isPastDue) {
      if (!currentMonthPaid) {
        return res.status(402).json({
          code: "TENANT_SUSPENDED",
          error: "Aplicacion suspendida, comunicate con tu administrador para dar de alta.",
          billing: {
            monthlyFeeArs: BILLING_MONTHLY_FEE_ARS,
            billingMonth: billingContext.billingMonth,
            dueDay: BILLING_WINDOW_END_DAY,
          acceptedMethods: PAYMENT_METHODS,
          canPayOnline: !!serverConfig.mpAccessToken,
          onlinePaymentMode:
            serverConfig.mpBillingMode === "subscription" && !manualOnlyBySubscription
              ? "subscription"
              : "checkout",
        },
      });
      }
    }

    req.tenant = tenant;
    return next();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error resolviendo tenant" });
  }
}

module.exports = { resolveTenant, getTenantSlugFromHost };

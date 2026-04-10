const { pool } = require("../db");
const { getServerConfig } = require("../config");
const { getTenantSlugFromHost } = require("../utils/tenant");
const {
  BILLING_MONTHLY_FEE_ARS,
  BILLING_WINDOW_END_DAY,
  getCurrentBillingContext,
} = require("../utils/billing");

const serverConfig = getServerConfig();

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
      `SELECT id, slug, name, plan, status, timezone, multi_branch_enabled
       FROM tenants
       WHERE slug = :slug
       LIMIT 1`,
      { slug: tenantSlug }
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Tenant no existe" });
    }

    const tenant = rows[0];
    if (tenant.status !== "active") {
      return res.status(403).json({
        code: "TENANT_SUSPENDED",
        error: "Aplicacion suspendida, comunicate con tu administrador para dar de alta.",
      });
    }

    const billingContext = getCurrentBillingContext(tenant.timezone);
    if (billingContext.isPastDue) {
      let paymentRows = [];
      try {
        const [rowsPaid] = await pool.query(
          `SELECT id
           FROM tenant_billing_payments
           WHERE tenant_id = :tenantId
             AND billing_month = :billingMonth
           LIMIT 1`,
          { tenantId: tenant.id, billingMonth: billingContext.billingMonth }
        );
        paymentRows = rowsPaid;
      } catch (e) {
        if (e?.code === "ER_NO_SUCH_TABLE") {
          console.warn(
            "[billing] Falta tabla tenant_billing_payments. Ejecuta la migración 005_tenant_billing_payments.sql"
          );
          paymentRows = [{ id: 0 }];
        } else {
          throw e;
        }
      }

      if (!paymentRows.length) {
        return res.status(402).json({
          code: "TENANT_SUSPENDED",
          error: "Aplicacion suspendida, comunicate con tu administrador para dar de alta.",
          billing: {
            monthlyFeeArs: BILLING_MONTHLY_FEE_ARS,
            billingMonth: billingContext.billingMonth,
            dueDay: BILLING_WINDOW_END_DAY,
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

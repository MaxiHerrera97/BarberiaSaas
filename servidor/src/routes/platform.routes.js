const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const { getServerConfig } = require("../config");
const { isValidSlug, normalizeSlug, sanitizeName } = require("../utils/onboarding");
const { auditLog, extractRequestIp } = require("../utils/audit");
const { createRateLimiter, createLoginAttemptGuard } = require("../middleware/rateLimit");
const {
  BILLING_MONTHLY_FEE_ARS,
  BILLING_WINDOW_END_DAY,
  PAYMENT_METHODS,
  getCurrentBillingContext,
  isValidBillingMonth,
  normalizePaymentMethod,
} = require("../utils/billing");

const router = express.Router();
const serverConfig = getServerConfig();

const platformLoginRateLimiter = createRateLimiter({
  windowMs: serverConfig.loginRateLimitWindowMs,
  maxAttempts: serverConfig.loginRateLimitMaxAttempts,
  keyFn: (req) => {
    const username = String(req.body?.username || "").trim().toLowerCase() || "unknown";
    return `platform:${extractRequestIp(req)}:${username}`;
  },
  message: "Demasiados intentos de ingreso. Espera unos minutos e intenta nuevamente.",
});

const platformLoginAttemptGuard = createLoginAttemptGuard({
  windowMs: serverConfig.loginLockWindowMs,
  maxFailures: serverConfig.loginLockMaxFailures,
  lockMs: serverConfig.loginLockDurationMs,
  keyFn: (req) => {
    const username = String(req.body?.username || "").trim().toLowerCase() || "unknown";
    return `platform:${extractRequestIp(req)}:${username}`;
  },
});

async function writePlatformAudit({ actorUsername, action, tenantId = null, targetUserId = null, details = null }) {
  try {
    await pool.query(
      `INSERT INTO platform_audit_logs
       (actor_username, action, tenant_id, target_user_id, details_json)
       VALUES
       (:actorUsername, :action, :tenantId, :targetUserId, :detailsJson)`,
      {
        actorUsername: String(actorUsername || "").slice(0, 80),
        action: String(action || "").slice(0, 80),
        tenantId: tenantId || null,
        targetUserId: targetUserId || null,
        detailsJson: details ? JSON.stringify(details) : null,
      }
    );
  } catch (e) {
    if (e?.code === "ER_NO_SUCH_TABLE") {
      console.warn("[platform-audit] Falta tabla platform_audit_logs. Ejecuta migración 006.");
      return;
    }
    throw e;
  }
}

function signPlatformToken(username) {
  return jwt.sign(
    {
      scope: "platform_admin",
      username,
    },
    serverConfig.jwtSecret,
    { expiresIn: serverConfig.platformJwtExpiresIn }
  );
}

function readBearerToken(req) {
  const header = String(req.headers.authorization || "");
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

function verifyPlatformToken(token) {
  try {
    const payload = jwt.verify(token, serverConfig.jwtSecret);
    if (payload?.scope !== "platform_admin") return null;
    if (String(payload?.username || "") !== serverConfig.platformAdminUsername) return null;
    return payload;
  } catch {
    return null;
  }
}

function requirePlatformAccess(req, res, next) {
  const tokenPayload = verifyPlatformToken(readBearerToken(req));
  if (tokenPayload) {
    req.platformUser = {
      username: tokenPayload.username,
    };
    return next();
  }

  if (!serverConfig.onboardingApiKey) {
    return res.status(503).json({
      error: "Onboarding API deshabilitada. Configura ONBOARDING_API_KEY.",
    });
  }

  const incoming = String(req.headers["x-onboarding-key"] || "");
  if (!incoming || incoming !== serverConfig.onboardingApiKey) {
    return res.status(401).json({ error: "No autorizado para plataforma" });
  }

  return next();
}

function requirePlatformToken(req, res, next) {
  const tokenPayload = verifyPlatformToken(readBearerToken(req));
  if (!tokenPayload) {
    return res.status(401).json({ error: "Token de plataforma inválido o vencido" });
  }

  req.platformUser = { username: tokenPayload.username };
  return next();
}

router.post("/auth/login", platformLoginRateLimiter, platformLoginAttemptGuard.middleware, async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (!username || !password) {
      return res.status(400).json({ error: "username y password requeridos" });
    }

    if (
      username !== serverConfig.platformAdminUsername ||
      password !== serverConfig.platformAdminPassword
    ) {
      platformLoginAttemptGuard.registerFailure(req);
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const token = signPlatformToken(username);
    platformLoginAttemptGuard.registerSuccess(req);
    auditLog("platform.auth.login.success", {
      username,
      ip: extractRequestIp(req),
    });
    await writePlatformAudit({
      actorUsername: username,
      action: "platform.auth.login",
      details: { ip: extractRequestIp(req) },
    });
    return res.json({
      token,
      user: {
        username,
        role: "platform_admin",
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error en login de plataforma" });
  }
});

router.get("/auth/me", requirePlatformToken, async (req, res) => {
  return res.json({
    user: {
      username: req.platformUser.username,
      role: "platform_admin",
    },
  });
});

router.post("/auth/logout", requirePlatformToken, async (_req, res) => {
  await writePlatformAudit({
    actorUsername: _req.platformUser.username,
    action: "platform.auth.logout",
  });
  return res.json({ ok: true });
});

router.get("/config", requirePlatformAccess, async (_req, res) => {
  return res.json({
    tenantBaseDomains: serverConfig.tenantBaseDomains || ["localhost"],
    tenantReservedSlugs: serverConfig.tenantReservedSlugs || ["www", "api", "app"],
    defaultPlan: "free",
    defaultTimezone: "America/Argentina/Buenos_Aires",
  });
});

router.post("/tenants/onboard", requirePlatformAccess, async (req, res) => {
  try {
    const tenantSlug = normalizeSlug(req.body?.tenantSlug);
    const tenantName = sanitizeName(req.body?.tenantName);
    const tenantPlan = ["free", "basic", "pro"].includes(req.body?.tenantPlan)
      ? req.body.tenantPlan
      : "free";
    const timezone = sanitizeName(req.body?.timezone || "America/Argentina/Buenos_Aires", 60);

    const adminName = sanitizeName(req.body?.adminName);
    const adminUsername = String(req.body?.adminUsername || "").trim().toLowerCase();
    const adminPassword = String(req.body?.adminPassword || "");

    const seedBarbers = Array.isArray(req.body?.seedBarbers) ? req.body.seedBarbers : [];
    const seedServices = Array.isArray(req.body?.seedServices) ? req.body.seedServices : [];

    if (!isValidSlug(tenantSlug)) {
      return res.status(400).json({ error: "tenantSlug inválido (3-80, a-z0-9 y guiones)" });
    }
    if (!tenantName) return res.status(400).json({ error: "tenantName requerido" });
    if (!adminName) return res.status(400).json({ error: "adminName requerido" });
    if (!/^[a-z0-9_.-]{3,60}$/.test(adminUsername)) {
      return res
        .status(400)
        .json({ error: "adminUsername inválido (3-60, minúsculas, números y ._-)" });
    }
    if (adminPassword.length < 8) {
      return res.status(400).json({ error: "adminPassword debe tener al menos 8 caracteres" });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [tenantInsert] = await conn.query(
        `INSERT INTO tenants (slug, name, plan, status, timezone, multi_branch_enabled)
         VALUES (:slug, :name, :plan, 'active', :timezone, 0)`,
        { slug: tenantSlug, name: tenantName, plan: tenantPlan, timezone }
      );
      const tenantId = tenantInsert.insertId;
      const [branchInsert] = await conn.query(
        `INSERT INTO branches (tenant_id, name, slug, is_active)
         VALUES (:tenantId, 'Sucursal Principal', 'principal', 1)`,
        { tenantId }
      );
      const defaultBranchId = branchInsert.insertId;

      await conn.query(
        `INSERT INTO tenant_settings (tenant_id, brand_name, hero_mode)
         VALUES (:tenantId, :brandName, 'generic')`,
        { tenantId, brandName: tenantName }
      );

      for (let day = 0; day <= 6; day += 1) {
        const isClosed = day === 0 ? 1 : 0;
        const open1 = "09:30:00";
        const close1 = day >= 1 && day <= 4 ? "13:00:00" : day >= 5 ? "14:00:00" : null;
        const open2 = day >= 1 && day <= 4 ? "18:00:00" : day >= 5 ? "16:00:00" : null;
        const close2 = day >= 1 && day <= 4 ? "21:30:00" : day >= 5 ? "22:00:00" : null;

        await conn.query(
          `INSERT INTO business_hours
           (tenant_id, day_of_week, is_closed, open1, close1, open2, close2)
           VALUES
           (:tenantId, :dayOfWeek, :isClosed, :open1, :close1, :open2, :close2)`,
          {
            tenantId,
            dayOfWeek: day,
            isClosed,
            open1: isClosed ? null : open1,
            close1: isClosed ? null : close1,
            open2: isClosed ? null : open2,
            close2: isClosed ? null : close2,
          }
        );
      }

      let createdBarbers = 0;
      for (const rawBarber of seedBarbers) {
        const fullName = sanitizeName(rawBarber);
        if (!fullName) continue;

        await conn.query(
          `INSERT INTO barbers (tenant_id, branch_id, full_name, is_active)
           VALUES (:tenantId, :branchId, :fullName, 1)`,
          { tenantId, branchId: defaultBranchId, fullName }
        );
        createdBarbers += 1;
      }

      let createdServices = 0;
      for (const service of seedServices) {
        const name = sanitizeName(service?.name);
        const priceArs = Number(service?.priceArs);
        const durationMin = Number(service?.durationMin);
        if (!name || !Number.isInteger(priceArs) || !Number.isInteger(durationMin)) continue;
        if (priceArs <= 0 || durationMin <= 0) continue;

        await conn.query(
          `INSERT INTO services (tenant_id, name, price_ars, duration_min, is_active)
           VALUES (:tenantId, :name, :priceArs, :durationMin, 1)`,
          { tenantId, name, priceArs, durationMin }
        );
        createdServices += 1;
      }

      const passwordHash = await bcrypt.hash(adminPassword, 10);
      const [userInsert] = await conn.query(
        `INSERT INTO users (tenant_id, branch_id, full_name, username, password_hash, role, barber_id, is_active)
         VALUES (:tenantId, NULL, :fullName, :username, :passwordHash, 'admin', NULL, 1)`,
        {
          tenantId,
          fullName: adminName,
          username: adminUsername,
          passwordHash,
        }
      );

      await conn.commit();
      await writePlatformAudit({
        actorUsername: req.platformUser?.username || "platform",
        action: "tenant.onboard.created",
        tenantId,
        details: {
          tenantSlug,
          tenantPlan,
          adminUsername,
          barbersCreated: createdBarbers,
          servicesCreated: createdServices,
        },
      });

      return res.status(201).json({
        tenant: {
          id: tenantId,
          slug: tenantSlug,
          name: tenantName,
          plan: tenantPlan,
          timezone,
        },
        adminUserId: userInsert.insertId,
        seed: {
          barbersCreated: createdBarbers,
          servicesCreated: createdServices,
        },
      });
    } catch (e) {
      await conn.rollback();
      if (e?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "Slug de tenant o username ya existente" });
      }
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error creando tenant" });
  }
});

router.get("/tenants", requirePlatformAccess, async (req, res) => {
  try {
    const [tenants] = await pool.query(
      `SELECT id, slug, name, plan, status, timezone,
              trial_active, trial_starts_at, trial_ends_at,
              multi_branch_enabled, created_at
       FROM tenants
       ORDER BY id ASC`
    );

    if (!tenants.length) {
      return res.json({
        billing: {
          monthlyFeeArs: BILLING_MONTHLY_FEE_ARS,
          paymentWindowStartDay: 1,
          paymentWindowEndDay: BILLING_WINDOW_END_DAY,
          acceptedMethods: PAYMENT_METHODS,
        },
        tenants: [],
      });
    }

    const paymentRows = [];
    for (const tenant of tenants) {
      const billing = getCurrentBillingContext(tenant.timezone);
      const [[payment]] = await pool.query(
        `SELECT billing_month, amount_ars, payment_method, paid_at
         FROM tenant_billing_payments
         WHERE tenant_id = :tenantId
           AND billing_month = :billingMonth
         LIMIT 1`,
        {
          tenantId: tenant.id,
          billingMonth: billing.billingMonth,
        }
      );

      paymentRows.push({
        ...tenant,
        multiBranchEnabled: Number(tenant.multi_branch_enabled || 0) === 1,
        trial: {
          enabled: Number(tenant.trial_active || 0) === 1,
          startedAt: tenant.trial_starts_at || null,
          endsAt: tenant.trial_ends_at || null,
        },
        billingMonth: billing.billingMonth,
        currentMonthPaid: !!payment,
        suspendedByPayment: billing.isPastDue && !payment,
        currentPayment: payment || null,
      });
    }

    return res.json({
      billing: {
        monthlyFeeArs: BILLING_MONTHLY_FEE_ARS,
        paymentWindowStartDay: 1,
        paymentWindowEndDay: BILLING_WINDOW_END_DAY,
        acceptedMethods: PAYMENT_METHODS,
      },
      tenants: paymentRows,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error listando tenants" });
  }
});

router.get("/billing/overview", requirePlatformAccess, async (req, res) => {
  try {
    const monthQuery = String(req.query?.month || "").trim();
    if (monthQuery && !isValidBillingMonth(monthQuery)) {
      return res.status(400).json({ error: "month inválido (YYYY-MM)" });
    }

    const [tenants] = await pool.query(
      `SELECT id, slug, name, plan, status, timezone,
              trial_active, trial_starts_at, trial_ends_at,
              multi_branch_enabled
       FROM tenants
       ORDER BY id ASC`
    );

    let collectedRevenueArs = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    let suspendedByPaymentCount = 0;
    const rows = [];

    for (const tenant of tenants) {
      const billingCtx = getCurrentBillingContext(tenant.timezone);
      const billingMonth = monthQuery || billingCtx.billingMonth;
      const [[payment]] = await pool.query(
        `SELECT id, amount_ars, payment_method, paid_at
         FROM tenant_billing_payments
         WHERE tenant_id = :tenantId
           AND billing_month = :billingMonth
         LIMIT 1`,
        { tenantId: tenant.id, billingMonth }
      );

      const isPaid = !!payment;
      if (isPaid) {
        paidCount += 1;
        collectedRevenueArs += Number(payment.amount_ars) || 0;
      } else {
        unpaidCount += 1;
      }

      const inCurrentMonth = billingMonth === billingCtx.billingMonth;
      const suspendedByPayment = inCurrentMonth && billingCtx.isPastDue && !isPaid;
      if (suspendedByPayment) suspendedByPaymentCount += 1;

      rows.push({
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        plan: tenant.plan,
        status: tenant.status,
        timezone: tenant.timezone,
        multiBranchEnabled: Number(tenant.multi_branch_enabled || 0) === 1,
        trial: {
          enabled: Number(tenant.trial_active || 0) === 1,
          startedAt: tenant.trial_starts_at || null,
          endsAt: tenant.trial_ends_at || null,
        },
        billingMonth,
        currentMonthPaid: isPaid,
        suspendedByPayment,
        payment: payment || null,
      });
    }

    const totalTenants = tenants.length;
    const expectedRevenueArs = totalTenants * BILLING_MONTHLY_FEE_ARS;
    const pendingRevenueArs = Math.max(0, expectedRevenueArs - collectedRevenueArs);

    return res.json({
      month: monthQuery || null,
      billing: {
        monthlyFeeArs: BILLING_MONTHLY_FEE_ARS,
        paymentWindowStartDay: 1,
        paymentWindowEndDay: BILLING_WINDOW_END_DAY,
        acceptedMethods: PAYMENT_METHODS,
      },
      summary: {
        totalTenants,
        activeTenants: tenants.filter((t) => t.status === "active").length,
        inactiveTenants: tenants.filter((t) => t.status !== "active").length,
        paidCount,
        unpaidCount,
        suspendedByPaymentCount,
        expectedRevenueArs,
        collectedRevenueArs,
        pendingRevenueArs,
      },
      tenants: rows,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error construyendo overview de billing" });
  }
});

function shiftBillingMonth(baseMonth, delta) {
  const [yearRaw, monthRaw] = String(baseMonth || "").split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return "";
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function parseMySqlDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const d = new Date(raw.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

router.get("/billing/metrics", requirePlatformAccess, async (req, res) => {
  try {
    const requestedMonth = String(req.query?.month || "").trim();
    if (requestedMonth && !isValidBillingMonth(requestedMonth)) {
      return res.status(400).json({ error: "month inválido (YYYY-MM)" });
    }

    const monthsWindow = Math.min(Math.max(Number(req.query?.months) || 6, 3), 12);
    const currentMonth = getCurrentBillingContext("America/Argentina/Buenos_Aires").billingMonth;
    const targetMonth = requestedMonth || currentMonth;

    const [tenants] = await pool.query(
      `SELECT id, slug, name, status, timezone,
              trial_active, trial_starts_at, trial_ends_at
       FROM tenants
       ORDER BY id ASC`
    );

    const totalTenants = tenants.length;
    const mrrArs = totalTenants * BILLING_MONTHLY_FEE_ARS;

    const [[paidAgg]] = await pool.query(
      `SELECT COUNT(*) AS paid_count, COALESCE(SUM(amount_ars), 0) AS collected_ars
       FROM tenant_billing_payments
       WHERE billing_month = :billingMonth`,
      { billingMonth: targetMonth }
    );
    const paidCount = Number(paidAgg?.paid_count || 0);
    const collectedArs = Number(paidAgg?.collected_ars || 0);
    const unpaidCount = Math.max(0, totalTenants - paidCount);
    const pendingArs = Math.max(0, mrrArs - collectedArs);
    const collectionRatePct = mrrArs > 0 ? Math.round((collectedArs / mrrArs) * 100) : 0;

    const [methodsRows] = await pool.query(
      `SELECT payment_method, COUNT(*) AS payments_count, COALESCE(SUM(amount_ars), 0) AS amount_ars
       FROM tenant_billing_payments
       WHERE billing_month = :billingMonth
       GROUP BY payment_method`,
      { billingMonth: targetMonth }
    );
    const byMethod = {
      transferencia: { method: "transferencia", count: 0, amountArs: 0, sharePct: 0 },
      mercado_pago: { method: "mercado_pago", count: 0, amountArs: 0, sharePct: 0 },
      efectivo: { method: "efectivo", count: 0, amountArs: 0, sharePct: 0 },
    };
    for (const row of methodsRows) {
      const method = String(row.payment_method || "").trim().toLowerCase();
      if (!byMethod[method]) continue;
      byMethod[method] = {
        method,
        count: Number(row.payments_count || 0),
        amountArs: Number(row.amount_ars || 0),
        sharePct: 0,
      };
    }
    const totalMethodsAmount = Object.values(byMethod).reduce((acc, m) => acc + (m.amountArs || 0), 0);
    for (const key of Object.keys(byMethod)) {
      byMethod[key].sharePct = totalMethodsAmount > 0
        ? Math.round((byMethod[key].amountArs / totalMethodsAmount) * 100)
        : 0;
    }

    const now = new Date();
    let trialActiveCount = 0;
    let suspendedTotalCount = 0;
    for (const tenant of tenants) {
      const trialEnabled = Number(tenant.trial_active || 0) === 1;
      const trialEndsAt = parseMySqlDateTime(tenant.trial_ends_at);
      const inTrialWindow = trialEnabled && (!trialEndsAt || trialEndsAt.getTime() >= now.getTime());
      if (inTrialWindow) trialActiveCount += 1;
      if (String(tenant.status || "").toLowerCase() !== "active") suspendedTotalCount += 1;
    }

    const trendMonths = [];
    for (let i = monthsWindow - 1; i >= 0; i -= 1) {
      trendMonths.push(shiftBillingMonth(targetMonth, -i));
    }
    const trend = [];
    for (const month of trendMonths) {
      const [[agg]] = await pool.query(
        `SELECT COUNT(*) AS paid_count, COALESCE(SUM(amount_ars), 0) AS collected_ars
         FROM tenant_billing_payments
         WHERE billing_month = :billingMonth`,
        { billingMonth: month }
      );
      const monthPaid = Number(agg?.paid_count || 0);
      const monthCollected = Number(agg?.collected_ars || 0);
      const monthUnpaid = Math.max(0, totalTenants - monthPaid);
      const monthExpected = mrrArs;
      trend.push({
        month,
        expectedArs: monthExpected,
        collectedArs: monthCollected,
        paidCount: monthPaid,
        unpaidCount: monthUnpaid,
        collectionRatePct: monthExpected > 0 ? Math.round((monthCollected / monthExpected) * 100) : 0,
      });
    }

    const overdueTenants = [];
    for (const tenant of tenants) {
      const ctx = getCurrentBillingContext(tenant.timezone);
      if (!ctx.isPastDue || ctx.billingMonth !== targetMonth) continue;
      const [[tenantPaid]] = await pool.query(
        `SELECT id
         FROM tenant_billing_payments
         WHERE tenant_id = :tenantId
           AND billing_month = :billingMonth
         LIMIT 1`,
        { tenantId: tenant.id, billingMonth: targetMonth }
      );
      if (tenantPaid) continue;
      overdueTenants.push({
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        billingMonth: targetMonth,
        daysLate: Math.max(1, Number(ctx.dayOfMonth || 0) - BILLING_WINDOW_END_DAY),
      });
    }

    return res.json({
      month: targetMonth,
      monthsWindow,
      billing: {
        monthlyFeeArs: BILLING_MONTHLY_FEE_ARS,
        paymentWindowStartDay: 1,
        paymentWindowEndDay: BILLING_WINDOW_END_DAY,
        acceptedMethods: PAYMENT_METHODS,
      },
      totals: {
        totalTenants,
        mrrArs,
        mrrCollectedArs: collectedArs,
        mrrPendingArs: pendingArs,
        paidCount,
        unpaidCount,
        collectedArs,
        pendingArs,
        collectionRatePct,
        trialActiveCount,
        suspendedTotalCount,
        overdueCount: overdueTenants.length,
      },
      methods: Object.values(byMethod),
      trend,
      overdueTenants,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error construyendo métricas de billing" });
  }
});

router.get("/tenants/:tenantId/billing", requirePlatformAccess, async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ error: "tenantId inválido" });
    }

    const [[tenant]] = await pool.query(
      `SELECT id, slug, name, status, timezone
       FROM tenants
       WHERE id = :tenantId
       LIMIT 1`,
      { tenantId }
    );
    if (!tenant) return res.status(404).json({ error: "Tenant no existe" });

    const billing = getCurrentBillingContext(tenant.timezone);
    const [[currentPayment]] = await pool.query(
      `SELECT id, billing_month, amount_ars, payment_method, paid_at
       FROM tenant_billing_payments
       WHERE tenant_id = :tenantId
         AND billing_month = :billingMonth
       LIMIT 1`,
      { tenantId, billingMonth: billing.billingMonth }
    );

    const [recentPayments] = await pool.query(
      `SELECT billing_month, amount_ars, payment_method, paid_at, notes
       FROM tenant_billing_payments
       WHERE tenant_id = :tenantId
       ORDER BY billing_month DESC
       LIMIT 12`,
      { tenantId }
    );

    const suspendedByPayment = billing.isPastDue && !currentPayment;

    return res.json({
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        timezone: tenant.timezone,
      },
      billing: {
        monthlyFeeArs: BILLING_MONTHLY_FEE_ARS,
        paymentWindowStartDay: 1,
        paymentWindowEndDay: BILLING_WINDOW_END_DAY,
        acceptedMethods: PAYMENT_METHODS,
        billingMonth: billing.billingMonth,
        currentMonthPaid: !!currentPayment,
        suspendedByPayment,
      },
      currentPayment: currentPayment || null,
      recentPayments,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error obteniendo estado de billing" });
  }
});

router.post("/tenants/:tenantId/payments", requirePlatformAccess, async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ error: "tenantId inválido" });
    }

    const [[tenant]] = await pool.query(
      `SELECT id, slug, name, timezone
       FROM tenants
       WHERE id = :tenantId
       LIMIT 1`,
      { tenantId }
    );
    if (!tenant) return res.status(404).json({ error: "Tenant no existe" });

    const defaultBillingMonth = getCurrentBillingContext(tenant.timezone).billingMonth;
    const billingMonth = String(req.body?.billingMonth || defaultBillingMonth).trim();
    if (!isValidBillingMonth(billingMonth)) {
      return res.status(400).json({ error: "billingMonth inválido (YYYY-MM)" });
    }

    const paymentMethod = normalizePaymentMethod(req.body?.paymentMethod);
    if (!paymentMethod) {
      return res.status(400).json({
        error: "paymentMethod inválido. Usa: transferencia, mercado_pago o efectivo",
      });
    }

    const amountArsRaw = Number(req.body?.amountArs);
    const amountArs = Number.isInteger(amountArsRaw) && amountArsRaw > 0
      ? amountArsRaw
      : BILLING_MONTHLY_FEE_ARS;

    const notes = String(req.body?.notes || "").trim().slice(0, 255);
    const recordedBy = String(req.body?.recordedBy || "").trim().slice(0, 80);

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
        amountArs,
        paymentMethod,
        notes: notes || null,
        recordedBy: recordedBy || null,
      }
    );

    await writePlatformAudit({
      actorUsername: req.platformUser?.username || "platform",
      action: "tenant.billing.payment.upsert",
      tenantId,
      details: {
        billingMonth,
        amountArs,
        paymentMethod,
      },
    });

    return res.status(201).json({
      ok: true,
      tenantId,
      billingMonth,
      amountArs,
      paymentMethod,
      message: "Pago registrado correctamente",
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error registrando pago" });
  }
});

router.delete(
  "/tenants/:tenantId/payments/:billingMonth",
  requirePlatformAccess,
  async (req, res) => {
    try {
      const tenantId = Number(req.params.tenantId);
      if (!Number.isInteger(tenantId) || tenantId <= 0) {
        return res.status(400).json({ error: "tenantId inválido" });
      }

      const billingMonth = String(req.params.billingMonth || "").trim();
      if (!isValidBillingMonth(billingMonth)) {
        return res.status(400).json({ error: "billingMonth inválido (YYYY-MM)" });
      }

      const [del] = await pool.query(
        `DELETE FROM tenant_billing_payments
         WHERE tenant_id = :tenantId
           AND billing_month = :billingMonth`,
        { tenantId, billingMonth }
      );

      await writePlatformAudit({
        actorUsername: req.platformUser?.username || "platform",
        action: "tenant.billing.payment.delete",
        tenantId,
        details: {
          billingMonth,
          deleted: del.affectedRows || 0,
        },
      });

      return res.json({
        ok: true,
        deleted: del.affectedRows || 0,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error eliminando pago" });
    }
  }
);

router.patch("/tenants/:tenantId/status", requirePlatformAccess, async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ error: "tenantId inválido" });
    }

    const status = String(req.body?.status || "")
      .trim()
      .toLowerCase();
    if (!["active", "inactive"].includes(status)) {
      return res.status(400).json({ error: "status inválido (active|inactive)" });
    }

    const [upd] = await pool.query(
      `UPDATE tenants
       SET status = :status
       WHERE id = :tenantId`,
      { tenantId, status }
    );

    if (!upd.affectedRows) {
      return res.status(404).json({ error: "Tenant no existe" });
    }

    await writePlatformAudit({
      actorUsername: req.platformUser?.username || "platform",
      action: "tenant.status.update",
      tenantId,
      details: { status },
    });

    return res.json({ ok: true, tenantId, status });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error actualizando estado del tenant" });
  }
});

router.patch("/tenants/:tenantId/trial", requirePlatformAccess, async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ error: "tenantId inválido" });
    }

    const enabled = req.body?.enabled !== false;
    const daysRaw = Number(req.body?.days);
    const trialDays = Number.isInteger(daysRaw) ? Math.min(Math.max(daysRaw, 1), 30) : 7;

    if (enabled) {
      const [upd] = await pool.query(
        `UPDATE tenants
         SET trial_active = 1,
             trial_starts_at = UTC_TIMESTAMP(),
             trial_ends_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL :trialDays DAY),
             status = 'active'
         WHERE id = :tenantId`,
        { tenantId, trialDays }
      );
      if (!upd.affectedRows) return res.status(404).json({ error: "Tenant no existe" });

      await writePlatformAudit({
        actorUsername: req.platformUser?.username || "platform",
        action: "tenant.trial.activate",
        tenantId,
        details: { trialDays },
      });
    } else {
      const [upd] = await pool.query(
        `UPDATE tenants
         SET trial_active = 0,
             trial_starts_at = NULL,
             trial_ends_at = NULL
         WHERE id = :tenantId`,
        { tenantId }
      );
      if (!upd.affectedRows) return res.status(404).json({ error: "Tenant no existe" });

      await writePlatformAudit({
        actorUsername: req.platformUser?.username || "platform",
        action: "tenant.trial.disable",
        tenantId,
      });
    }

    const [[tenant]] = await pool.query(
      `SELECT id, trial_active, trial_starts_at, trial_ends_at, status
       FROM tenants
       WHERE id = :tenantId
       LIMIT 1`,
      { tenantId }
    );

    return res.json({
      ok: true,
      tenantId,
      status: tenant?.status || "inactive",
      trial: {
        enabled: Number(tenant?.trial_active || 0) === 1,
        startedAt: tenant?.trial_starts_at || null,
        endsAt: tenant?.trial_ends_at || null,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error actualizando prueba gratuita" });
  }
});

router.patch("/tenants/:tenantId/multi-branch", requirePlatformAccess, async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ error: "tenantId inválido" });
    }

    const enabled = req.body?.enabled === true;

    const [upd] = await pool.query(
      `UPDATE tenants
       SET multi_branch_enabled = :enabled
       WHERE id = :tenantId`,
      { tenantId, enabled: enabled ? 1 : 0 }
    );

    if (!upd.affectedRows) {
      return res.status(404).json({ error: "Tenant no existe" });
    }

    await writePlatformAudit({
      actorUsername: req.platformUser?.username || "platform",
      action: "tenant.multi_branch.update",
      tenantId,
      details: { enabled: enabled ? 1 : 0 },
    });

    return res.json({ ok: true, tenantId, multiBranchEnabled: enabled });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error actualizando multi-sucursal" });
  }
});

router.delete("/tenants/:tenantId/permanent", requirePlatformAccess, async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ error: "tenantId inválido" });
    }

    const [[tenant]] = await pool.query(
      `SELECT id, slug, name, status
       FROM tenants
       WHERE id = :tenantId
       LIMIT 1`,
      { tenantId }
    );
    if (!tenant) return res.status(404).json({ error: "Tenant no existe" });
    if (String(tenant.status || "") === "active") {
      return res.status(400).json({
        error: "Primero inactiva el tenant antes de eliminarlo definitivamente",
      });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Borrado explícito por orden para evitar FK RESTRICT.
      await conn.query(`DELETE FROM appointment_holds WHERE tenant_id = :tenantId`, { tenantId });
      await conn.query(`DELETE FROM appointments WHERE tenant_id = :tenantId`, { tenantId });
      await conn.query(`DELETE FROM barber_schedule_exceptions WHERE tenant_id = :tenantId`, { tenantId });
      await conn.query(`DELETE FROM barber_business_hours WHERE tenant_id = :tenantId`, { tenantId });
      await conn.query(`DELETE FROM users WHERE tenant_id = :tenantId`, { tenantId });
      await conn.query(`DELETE FROM barbers WHERE tenant_id = :tenantId`, { tenantId });
      await conn.query(`DELETE FROM services WHERE tenant_id = :tenantId`, { tenantId });
      await conn.query(`DELETE FROM business_hours WHERE tenant_id = :tenantId`, { tenantId });
      await conn.query(`DELETE FROM tenant_gallery WHERE tenant_id = :tenantId`, { tenantId });
      await conn.query(`DELETE FROM tenant_settings WHERE tenant_id = :tenantId`, { tenantId });
      await conn.query(`DELETE FROM tenant_billing_payments WHERE tenant_id = :tenantId`, { tenantId });
      await conn.query(`DELETE FROM branches WHERE tenant_id = :tenantId`, { tenantId });
      const [tenantDel] = await conn.query(`DELETE FROM tenants WHERE id = :tenantId`, { tenantId });
      if (!tenantDel?.affectedRows) {
        await conn.rollback();
        return res.status(404).json({ error: "Tenant no existe" });
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    await writePlatformAudit({
      actorUsername: req.platformUser?.username || "platform",
      action: "tenant.delete.permanent",
      details: {
        deletedTenantId: tenant.id,
        deletedTenantSlug: tenant.slug,
        deletedTenantName: tenant.name,
      },
    });

    return res.json({
      ok: true,
      deletedTenantId: tenant.id,
      deletedTenantSlug: tenant.slug,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error eliminando tenant definitivamente" });
  }
});

router.get("/tenants/:tenantId/overview", requirePlatformAccess, async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ error: "tenantId inválido" });
    }

    const [[tenant]] = await pool.query(
      `SELECT id, slug, name, plan, status, timezone,
              trial_active, trial_starts_at, trial_ends_at,
              multi_branch_enabled, created_at
       FROM tenants
       WHERE id = :tenantId
       LIMIT 1`,
      { tenantId }
    );
    if (!tenant) return res.status(404).json({ error: "Tenant no existe" });

    const [[settings]] = await pool.query(
      `SELECT brand_name, tagline, contact_phone, contact_whatsapp, contact_instagram, address, logo_url
       FROM tenant_settings
       WHERE tenant_id = :tenantId
       LIMIT 1`,
      { tenantId }
    );

    const [hours] = await pool.query(
      `SELECT day_of_week, is_closed, open1, close1, open2, close2
       FROM business_hours
       WHERE tenant_id = :tenantId
       ORDER BY day_of_week ASC`,
      { tenantId }
    );
    const [barbers] = await pool.query(
      `SELECT id, full_name, branch_id, is_active
       FROM barbers
       WHERE tenant_id = :tenantId
       ORDER BY full_name ASC`,
      { tenantId }
    );

    const [[counts]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM barbers b WHERE b.tenant_id = :tenantId) AS barbers_total,
         (SELECT COUNT(*) FROM barbers b WHERE b.tenant_id = :tenantId AND b.is_active = 1) AS barbers_active,
         (SELECT COUNT(*) FROM services s WHERE s.tenant_id = :tenantId) AS services_total,
         (SELECT COUNT(*) FROM services s WHERE s.tenant_id = :tenantId AND s.is_active = 1) AS services_active,
         (SELECT COUNT(*) FROM users u WHERE u.tenant_id = :tenantId) AS users_total,
         (SELECT COUNT(*) FROM users u WHERE u.tenant_id = :tenantId AND u.is_active = 1) AS users_active`,
      { tenantId }
    );

    const [userAccounts] = await pool.query(
      `SELECT id, full_name, username, role, branch_id, barber_id, is_active, last_login_at, created_at
       FROM users
       WHERE tenant_id = :tenantId
       ORDER BY role DESC, id ASC`,
      { tenantId }
    );

    const [barbersWithoutUser] = await pool.query(
      `SELECT b.id, b.full_name, b.branch_id, b.is_active, br.name AS branch_name
       FROM barbers b
       LEFT JOIN users u
         ON u.tenant_id = b.tenant_id
        AND u.role = 'barber'
        AND u.barber_id = b.id
       LEFT JOIN branches br ON br.id = b.branch_id
       WHERE b.tenant_id = :tenantId
         AND b.is_active = 1
         AND u.id IS NULL
       ORDER BY b.full_name ASC`,
      { tenantId }
    );

    const [recentAppointments] = await pool.query(
      `SELECT a.id, a.customer_name, a.customer_phone, a.start_at, a.end_at, a.status,
              b.full_name AS barber_name, s.name AS service_name
       FROM appointments a
       INNER JOIN barbers b ON b.id = a.barber_id
       INNER JOIN services s ON s.id = a.service_id
       WHERE a.tenant_id = :tenantId
       ORDER BY a.start_at DESC
       LIMIT 12`,
      { tenantId }
    );

    const [[appointmentStats]] = await pool.query(
      `SELECT
         SUM(CASE WHEN DATE(a.start_at) = CURRENT_DATE THEN 1 ELSE 0 END) AS today_total,
         SUM(CASE WHEN DATE(a.start_at) = CURRENT_DATE AND a.status = 'pending' THEN 1 ELSE 0 END) AS today_pending,
         SUM(CASE WHEN DATE(a.start_at) = CURRENT_DATE AND a.status = 'in_progress' THEN 1 ELSE 0 END) AS today_in_progress,
         SUM(CASE WHEN DATE(a.start_at) = CURRENT_DATE AND a.status = 'done' THEN 1 ELSE 0 END) AS today_done,
         SUM(CASE WHEN YEAR(a.start_at) = YEAR(CURRENT_DATE) AND MONTH(a.start_at) = MONTH(CURRENT_DATE) THEN 1 ELSE 0 END) AS month_total,
         SUM(CASE WHEN YEAR(a.start_at) = YEAR(CURRENT_DATE) AND MONTH(a.start_at) = MONTH(CURRENT_DATE) AND a.status = 'done' THEN 1 ELSE 0 END) AS month_done
       FROM appointments a
       WHERE a.tenant_id = :tenantId`,
      { tenantId }
    );

    const billingCtx = getCurrentBillingContext(tenant.timezone);
    const [[payment]] = await pool.query(
      `SELECT id, billing_month, amount_ars, payment_method, paid_at, notes
       FROM tenant_billing_payments
       WHERE tenant_id = :tenantId
         AND billing_month = :billingMonth
       LIMIT 1`,
      { tenantId, billingMonth: billingCtx.billingMonth }
    );

    return res.json({
      tenant: {
        ...tenant,
        multiBranchEnabled: Number(tenant.multi_branch_enabled || 0) === 1,
        trial: {
          enabled: Number(tenant.trial_active || 0) === 1,
          startedAt: tenant.trial_starts_at || null,
          endsAt: tenant.trial_ends_at || null,
        },
      },
      settings: settings || null,
      businessHours: hours,
      barbers,
      billing: {
        billingMonth: billingCtx.billingMonth,
        currentMonthPaid: !!payment,
        currentPayment: payment || null,
        suspendedByPayment: billingCtx.isPastDue && !payment,
      },
      counts: {
        barbersTotal: Number(counts?.barbers_total || 0),
        barbersActive: Number(counts?.barbers_active || 0),
        servicesTotal: Number(counts?.services_total || 0),
        servicesActive: Number(counts?.services_active || 0),
        usersTotal: Number(counts?.users_total || 0),
        usersActive: Number(counts?.users_active || 0),
      },
      appointmentStats: {
        todayTotal: Number(appointmentStats?.today_total || 0),
        todayPending: Number(appointmentStats?.today_pending || 0),
        todayInProgress: Number(appointmentStats?.today_in_progress || 0),
        todayDone: Number(appointmentStats?.today_done || 0),
        monthTotal: Number(appointmentStats?.month_total || 0),
        monthDone: Number(appointmentStats?.month_done || 0),
      },
      userAccounts,
      barbersWithoutUser,
      recentAppointments,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error cargando overview del tenant" });
  }
});

router.post("/tenants/:tenantId/users", requirePlatformAccess, async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ error: "tenantId inválido" });
    }

    const fullName = String(req.body?.fullName || "").trim().slice(0, 120);
    const username = String(req.body?.username || "")
      .trim()
      .toLowerCase();
    const role = String(req.body?.role || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");
    const barberId = req.body?.barberId === null || req.body?.barberId === undefined
      ? null
      : Number(req.body?.barberId);

    if (!fullName) return res.status(400).json({ error: "fullName requerido" });
    if (!/^[a-z0-9_.-]{3,60}$/.test(username)) {
      return res
        .status(400)
        .json({ error: "username inválido (3-60, minúsculas, números y ._-)" });
    }
    if (!["admin", "barber"].includes(role)) {
      return res.status(400).json({ error: "role inválido (admin|barber)" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "password debe tener al menos 8 caracteres" });
    }

    let finalBarberId = null;
    let finalBranchId = null;
    if (role === "barber") {
      if (!Number.isInteger(barberId) || barberId <= 0) {
        return res.status(400).json({ error: "barberId requerido para role=barber" });
      }
      const [[barber]] = await pool.query(
        `SELECT id, is_active, branch_id
         FROM barbers
         WHERE id = :barberId
           AND tenant_id = :tenantId
         LIMIT 1`,
        { barberId, tenantId }
      );
      if (!barber) {
        return res.status(400).json({ error: "barberId no existe en este tenant" });
      }
      finalBarberId = barber.id;
      finalBranchId = barber.branch_id ? Number(barber.branch_id) : null;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [ins] = await pool.query(
      `INSERT INTO users
       (tenant_id, branch_id, full_name, username, password_hash, role, barber_id, is_active)
       VALUES
       (:tenantId, :branchId, :fullName, :username, :passwordHash, :role, :barberId, 1)`,
      {
        tenantId,
        branchId: finalBranchId,
        fullName,
        username,
        passwordHash,
        role,
        barberId: finalBarberId,
      }
    );

    await writePlatformAudit({
      actorUsername: req.platformUser?.username || "platform",
      action: "tenant.user.create",
      tenantId,
      targetUserId: ins.insertId,
      details: {
        username,
        role,
        barberId: finalBarberId,
        branchId: finalBranchId,
      },
    });

    return res.status(201).json({
      ok: true,
      user: {
        id: ins.insertId,
        tenantId,
        fullName,
        username,
        role,
        barberId: finalBarberId,
        branchId: finalBranchId,
        isActive: true,
      },
    });
  } catch (e) {
    if (e?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Username ya existe en este tenant" });
    }
    console.error(e);
    return res.status(500).json({ error: "Error creando usuario" });
  }
});

router.patch("/tenants/:tenantId/users/:userId/status", requirePlatformAccess, async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    const userId = Number(req.params.userId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ error: "tenantId inválido" });
    }
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "userId inválido" });
    }

    const isActive = !!req.body?.isActive;

    const [upd] = await pool.query(
      `UPDATE users
       SET is_active = :isActive
       WHERE id = :userId AND tenant_id = :tenantId`,
      { userId, tenantId, isActive: isActive ? 1 : 0 }
    );
    if (!upd.affectedRows) return res.status(404).json({ error: "Usuario no existe en tenant" });

    await writePlatformAudit({
      actorUsername: req.platformUser?.username || "platform",
      action: "tenant.user.status.update",
      tenantId,
      targetUserId: userId,
      details: { isActive: isActive ? 1 : 0 },
    });

    return res.json({ ok: true, tenantId, userId, isActive });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error actualizando estado del usuario" });
  }
});

router.post("/tenants/:tenantId/users/:userId/reset-password", requirePlatformAccess, async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    const userId = Number(req.params.userId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ error: "tenantId inválido" });
    }
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "userId inválido" });
    }

    const incomingPassword = String(req.body?.newPassword || "");
    const generatedPassword = `Nueva-${Math.random().toString(36).slice(2, 8)}#${Date.now()
      .toString()
      .slice(-3)}`;
    const nextPassword = incomingPassword || generatedPassword;
    if (nextPassword.length < 8) {
      return res.status(400).json({ error: "newPassword debe tener al menos 8 caracteres" });
    }

    const passwordHash = await bcrypt.hash(nextPassword, 10);
    const [upd] = await pool.query(
      `UPDATE users
       SET password_hash = :passwordHash
       WHERE id = :userId AND tenant_id = :tenantId`,
      { userId, tenantId, passwordHash }
    );
    if (!upd.affectedRows) return res.status(404).json({ error: "Usuario no existe en tenant" });

    await writePlatformAudit({
      actorUsername: req.platformUser?.username || "platform",
      action: "tenant.user.password.reset",
      tenantId,
      targetUserId: userId,
      details: { customPassword: !!incomingPassword },
    });

    return res.json({
      ok: true,
      tenantId,
      userId,
      generated: !incomingPassword,
      newPassword: nextPassword,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error reseteando contraseña" });
  }
});

router.delete("/tenants/:tenantId/users/:userId", requirePlatformAccess, async (req, res) => {
  try {
    const tenantId = Number(req.params.tenantId);
    const userId = Number(req.params.userId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ error: "tenantId inválido" });
    }
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "userId inválido" });
    }

    const [[user]] = await pool.query(
      `SELECT id, username, role, is_active
       FROM users
       WHERE id = :userId AND tenant_id = :tenantId
       LIMIT 1`,
      { userId, tenantId }
    );
    if (!user) return res.status(404).json({ error: "Usuario no existe en tenant" });

    if (String(user.role) !== "barber") {
      return res.status(400).json({ error: "Solo se puede eliminar usuarios con rol barber" });
    }
    if (Number(user.is_active) === 1) {
      return res.status(400).json({ error: "Primero inactiva el usuario antes de eliminarlo" });
    }

    const [del] = await pool.query(
      `DELETE FROM users
       WHERE id = :userId AND tenant_id = :tenantId
       LIMIT 1`,
      { userId, tenantId }
    );
    if (!del.affectedRows) return res.status(404).json({ error: "Usuario no existe en tenant" });

    await writePlatformAudit({
      actorUsername: req.platformUser?.username || "platform",
      action: "tenant.user.delete",
      tenantId,
      targetUserId: userId,
      details: {
        username: user.username,
        role: user.role,
      },
    });

    return res.json({ ok: true, tenantId, userId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error eliminando usuario" });
  }
});

router.get("/audit", requirePlatformAccess, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query?.limit) || 100, 1), 500);
    const [rows] = await pool.query(
      `SELECT id, actor_username, action, tenant_id, target_user_id, details_json, created_at
       FROM platform_audit_logs
       ORDER BY id DESC
       LIMIT :limit`,
      { limit }
    );

    return res.json({
      limit,
      logs: rows.map((r) => ({
        id: r.id,
        actorUsername: r.actor_username,
        action: r.action,
        tenantId: r.tenant_id,
        targetUserId: r.target_user_id,
        details: (() => {
          if (!r.details_json) return null;
          if (typeof r.details_json === "object") return r.details_json;
          try {
            return JSON.parse(r.details_json);
          } catch {
            return { raw: String(r.details_json) };
          }
        })(),
        createdAt: r.created_at,
      })),
    });
  } catch (e) {
    if (e?.code === "ER_NO_SUCH_TABLE") {
      return res.status(500).json({
        error: "Falta tabla platform_audit_logs. Ejecuta migración 006_platform_audit_logs.sql",
      });
    }
    console.error(e);
    return res.status(500).json({ error: "Error obteniendo auditoría de plataforma" });
  }
});

module.exports = router;

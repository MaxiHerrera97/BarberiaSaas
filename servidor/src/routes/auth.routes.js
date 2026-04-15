const express = require("express");
const bcrypt = require("bcrypt");
const { pool } = require("../db");
const { getServerConfig } = require("../config");
const { auth } = require("../middleware/auth");
const { createRateLimiter, createLoginAttemptGuard } = require("../middleware/rateLimit");
const {
  attachSessionCookie,
  clearSessionCookie,
  signSessionToken,
  toPublicUser,
} = require("../utils/session");
const { auditLog, extractRequestIp } = require("../utils/audit");

const router = express.Router();
const serverConfig = getServerConfig();

const loginRateLimiter = createRateLimiter({
  windowMs: serverConfig.loginRateLimitWindowMs,
  maxAttempts: serverConfig.loginRateLimitMaxAttempts,
  keyFn: (req) => {
    const username = String(req.body?.username || "").trim().toLowerCase() || "unknown";
    const tenantId = req.tenant?.id || "unknown-tenant";
    return `${tenantId}:${extractRequestIp(req)}:${username}`;
  },
  message: "Demasiados intentos de login. Espera unos minutos e intenta nuevamente.",
});

const loginAttemptGuard = createLoginAttemptGuard({
  windowMs: serverConfig.loginLockWindowMs,
  maxFailures: serverConfig.loginLockMaxFailures,
  lockMs: serverConfig.loginLockDurationMs,
  keyFn: (req) => {
    const username = String(req.body?.username || "").trim().toLowerCase() || "unknown";
    const tenantId = req.tenant?.id || "unknown-tenant";
    return `${tenantId}:${extractRequestIp(req)}:${username}`;
  },
});

router.post("/login", loginRateLimiter, loginAttemptGuard.middleware, async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password) {
      return res.status(400).json({ error: "username y password requeridos" });
    }

    const [rows] = await pool.query(
      `SELECT u.id, u.tenant_id, t.slug AS tenant_slug, u.full_name, u.username,
              u.password_hash, u.role, u.barber_id, u.branch_id, u.is_active
       FROM users u
       INNER JOIN tenants t ON t.id = u.tenant_id
       WHERE u.username = :username AND u.tenant_id = :tenantId
       LIMIT 1`,
      { username, tenantId: req.tenant.id }
    );

    if (!rows.length) {
      loginAttemptGuard.registerFailure(req);
      auditLog("auth.login.failed", {
        username,
        reason: "user_not_found",
        tenantId: req.tenant.id,
        ip: extractRequestIp(req),
      });
      return res.status(401).json({ error: "Credenciales inválidas" });
    }
    const u = rows[0];
    if (!u.is_active) {
      loginAttemptGuard.registerFailure(req);
      auditLog("auth.login.blocked", {
        username,
        reason: "user_disabled",
        userId: u.id,
        tenantId: req.tenant.id,
        ip: extractRequestIp(req),
      });
      return res.status(403).json({ error: "Usuario deshabilitado" });
    }

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) {
      loginAttemptGuard.registerFailure(req);
      auditLog("auth.login.failed", {
        username,
        reason: "invalid_password",
        userId: u.id,
        tenantId: req.tenant.id,
        ip: extractRequestIp(req),
      });
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = :id`, { id: u.id });
    loginAttemptGuard.registerSuccess(req);

    const token = signSessionToken(u);
    attachSessionCookie(res, token);
    auditLog("auth.login.success", {
      username,
      userId: u.id,
      role: u.role,
      tenantId: req.tenant.id,
      ip: extractRequestIp(req),
    });

    return res.json({
      token,
      user: toPublicUser(u),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error en login" });
  }
});

router.get("/me", auth, async (req, res) => {
  return res.json({ user: toPublicUser(req.user) });
});

router.post("/logout", (req, res) => {
  auditLog("auth.logout", {
    tenantId: req.tenant?.id,
    ip: extractRequestIp(req),
  });
  clearSessionCookie(res);
  return res.json({ ok: true });
});

module.exports = router;

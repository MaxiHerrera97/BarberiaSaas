function createRateLimiter({
  windowMs,
  maxAttempts,
  keyFn,
  message = "Demasiados intentos. Intenta nuevamente más tarde.",
}) {
  const attempts = new Map();

  function cleanup(now) {
    for (const [key, entry] of attempts.entries()) {
      if (entry.expiresAt <= now) attempts.delete(key);
    }
  }

  return function rateLimit(req, res, next) {
    const now = Date.now();
    cleanup(now);

    const key = keyFn(req);
    const current = attempts.get(key);

    if (!current || current.expiresAt <= now) {
      attempts.set(key, { count: 1, expiresAt: now + windowMs });
      return next();
    }

    if (current.count >= maxAttempts) {
      const retryAfterSec = Math.max(1, Math.ceil((current.expiresAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({ error: message });
    }

    current.count += 1;
    attempts.set(key, current);
    return next();
  };
}

function createLoginAttemptGuard({
  windowMs,
  maxFailures,
  lockMs,
  keyFn,
  message = "Por seguridad, este acceso quedó bloqueado temporalmente por intentos fallidos.",
}) {
  const entries = new Map();

  function cleanup(now) {
    for (const [key, entry] of entries.entries()) {
      const lockExpired = !entry.lockedUntil || entry.lockedUntil <= now;
      const windowExpired = !entry.windowExpiresAt || entry.windowExpiresAt <= now;
      if (lockExpired && windowExpired) entries.delete(key);
    }
  }

  function getEntry(key, now) {
    const current = entries.get(key);
    if (!current) return null;

    if (current.windowExpiresAt <= now) {
      current.failures = 0;
      current.windowExpiresAt = now + windowMs;
    }
    if (current.lockedUntil && current.lockedUntil <= now) {
      current.lockedUntil = 0;
      current.failures = 0;
      current.windowExpiresAt = now + windowMs;
    }

    entries.set(key, current);
    return current;
  }

  function ensureEntry(key, now) {
    const existing = getEntry(key, now);
    if (existing) return existing;
    const fresh = {
      failures: 0,
      windowExpiresAt: now + windowMs,
      lockedUntil: 0,
    };
    entries.set(key, fresh);
    return fresh;
  }

  function middleware(req, res, next) {
    const now = Date.now();
    cleanup(now);

    const key = keyFn(req);
    const entry = getEntry(key, now);
    if (entry?.lockedUntil && entry.lockedUntil > now) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(423).json({
        error: message,
        retryAfterSec,
      });
    }

    return next();
  }

  function registerFailure(req) {
    const now = Date.now();
    cleanup(now);
    const key = keyFn(req);
    const entry = ensureEntry(key, now);

    entry.failures += 1;
    if (entry.failures >= maxFailures) {
      entry.lockedUntil = now + lockMs;
      entry.failures = 0;
      entry.windowExpiresAt = now + windowMs;
    }
    entries.set(key, entry);
  }

  function registerSuccess(req) {
    const key = keyFn(req);
    entries.delete(key);
  }

  return {
    middleware,
    registerFailure,
    registerSuccess,
  };
}

module.exports = {
  createRateLimiter,
  createLoginAttemptGuard,
};

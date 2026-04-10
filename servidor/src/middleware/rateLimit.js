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

module.exports = {
  createRateLimiter,
};

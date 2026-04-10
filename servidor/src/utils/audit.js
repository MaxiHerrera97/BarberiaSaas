function extractRequestIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function auditLog(event, details = {}) {
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...details,
  };

  console.info("[AUDIT]", JSON.stringify(payload));
}

module.exports = {
  auditLog,
  extractRequestIp,
};

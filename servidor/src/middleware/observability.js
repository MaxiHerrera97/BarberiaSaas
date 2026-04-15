const { randomUUID } = require("crypto");

function requestContext(req, res, next) {
  const reqId = randomUUID();
  const startedAt = Date.now();

  req.requestId = reqId;
  res.setHeader("X-Request-Id", reqId);

  res.on("finish", () => {
    if (req.path === "/health") return;
    const durationMs = Date.now() - startedAt;
    const ip =
      String(req.headers["x-forwarded-for"] || "")
        .split(",")[0]
        .trim() || req.socket?.remoteAddress || "-";
    console.log(
      `[req] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms) ip=${ip} id=${reqId}`
    );
  });

  next();
}

module.exports = {
  requestContext,
};


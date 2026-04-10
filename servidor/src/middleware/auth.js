const jwt = require("jsonwebtoken");
const { getServerConfig } = require("../config");
const { parseCookies } = require("../utils/cookies");

const serverConfig = getServerConfig();

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const bearerToken = header.startsWith("Bearer ") ? header.slice(7) : null;
  const cookies = parseCookies(req.headers.cookie || "");
  const cookieToken = cookies[serverConfig.cookieName] || null;
  const token = bearerToken || cookieToken;

  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const payload = jwt.verify(token, serverConfig.jwtSecret);
    const tenantId = Number(payload.tenantId);
    const reqTenantId = Number(req.tenant?.id);
    if (!tenantId || !reqTenantId || tenantId !== reqTenantId) {
      return res.status(401).json({ error: "Invalid tenant token" });
    }
    req.user = payload; // { userId, role, barberId, name }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

module.exports = { auth };

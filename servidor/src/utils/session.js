const jwt = require("jsonwebtoken");
const { getServerConfig } = require("../config");
const { serializeCookie } = require("./cookies");

const serverConfig = getServerConfig();

function signSessionToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      tenantId: user.tenant_id ?? user.tenantId,
      tenantSlug: user.tenant_slug ?? user.tenantSlug,
      name: user.full_name,
      role: user.role,
      barberId: user.barber_id,
      branchId: user.branch_id ?? user.branchId ?? null,
    },
    serverConfig.jwtSecret,
    { expiresIn: serverConfig.jwtExpiresIn }
  );
}

function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: serverConfig.cookieSecure,
    sameSite: serverConfig.cookieSameSite,
    domain: serverConfig.cookieDomain || undefined,
    path: "/",
  };
}

function attachSessionCookie(res, token) {
  res.append(
    "Set-Cookie",
    serializeCookie(serverConfig.cookieName, token, getSessionCookieOptions())
  );
}

function clearSessionCookie(res) {
  res.append(
    "Set-Cookie",
    serializeCookie(serverConfig.cookieName, "", {
      ...getSessionCookieOptions(),
      expires: new Date(0),
      maxAge: 0,
    })
  );
}

function toPublicUser(userLike) {
  return {
    id: userLike.id ?? userLike.userId,
    tenantId: userLike.tenant_id ?? userLike.tenantId ?? null,
    name: userLike.full_name ?? userLike.name,
    role: userLike.role,
    barberId: userLike.barber_id ?? userLike.barberId ?? null,
    branchId: userLike.branch_id ?? userLike.branchId ?? null,
  };
}

module.exports = {
  attachSessionCookie,
  clearSessionCookie,
  signSessionToken,
  toPublicUser,
};

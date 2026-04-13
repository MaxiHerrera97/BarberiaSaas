const express = require("express");
const cors = require("cors");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
const { getServerConfig } = require("./config");
const { securityHeaders } = require("./middleware/security");
const { resolveTenant } = require("./middleware/tenant");

const authRoutes = require("./routes/auth.routes");
const barbersRoutes = require("./routes/barbers.routes");
const appointmentsRoutes = require("./routes/appointments.routes");
const servicesRoutes = require("./routes/services.routes");
const platformRoutes = require("./routes/platform.routes");
const tenantConfigRoutes = require("./routes/tenant-config.routes");
const branchesRoutes = require("./routes/branches.routes");
const billingPublicRoutes = require("./routes/billing-public.routes");

const app = express();
const serverConfig = getServerConfig();

function parseOriginUrl(value) {
  try {
    return new URL(String(value || "").trim());
  } catch {
    return null;
  }
}

function isAllowedCorsOrigin(origin, allowlist) {
  const normalizedOrigin = String(origin || "").trim();
  if (!normalizedOrigin) return false;

  const originUrl = parseOriginUrl(normalizedOrigin);
  if (!originUrl) return false;

  return allowlist.some((entry) => {
    const rule = String(entry || "").trim();
    if (!rule) return false;

    if (rule === normalizedOrigin) return true;

    // Soporte wildcard por host para SaaS, ej:
    // - https://*.go.hmgdev.com.ar
    // - *.go.hmgdev.com.ar
    if (rule.includes("*")) {
      const protocolWildcardMatch = rule.match(/^(https?):\/\/\*\.(.+)$/i);
      if (protocolWildcardMatch) {
        const [, protocol, baseHost] = protocolWildcardMatch;
        return (
          originUrl.protocol === `${protocol.toLowerCase()}:` &&
          originUrl.hostname.toLowerCase().endsWith(`.${baseHost.toLowerCase()}`)
        );
      }

      const hostWildcardMatch = rule.match(/^\*\.(.+)$/i);
      if (hostWildcardMatch) {
        const [, baseHost] = hostWildcardMatch;
        return originUrl.hostname.toLowerCase().endsWith(`.${baseHost.toLowerCase()}`);
      }
    }

    return false;
  });
}

if (serverConfig.trustProxy) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");
app.use(securityHeaders);
app.use(
  cors({
    origin: (origin, cb) => {
      // Permitir herramientas sin origin (curl, Postman, etc.)
      if (!origin) return cb(null, true);

      // Si no se configuró lista, se permite todo (fallback dev)
      if (!serverConfig.corsOrigins.length) return cb(null, true);

      return isAllowedCorsOrigin(origin, serverConfig.corsOrigins)
        ? cb(null, true)
        : cb(new Error("CORS: origin no permitido"));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "5mb" }));
app.use("/uploads", express.static(path.resolve(__dirname, "..", "uploads")));

app.get("/health", (_, res) => res.json({ ok: true }));

app.use("/platform", platformRoutes);
app.use("/billing", billingPublicRoutes);
app.use(resolveTenant);
app.use("/auth", authRoutes);
app.use("/barbers", barbersRoutes);
app.use("/appointments", appointmentsRoutes);
app.use("/services", servicesRoutes);
app.use("/tenant-config", tenantConfigRoutes);
app.use("/branches", branchesRoutes);

const port = serverConfig.port;
app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});

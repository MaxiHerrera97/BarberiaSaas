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

const app = express();
const serverConfig = getServerConfig();

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

      return serverConfig.corsOrigins.includes(origin)
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

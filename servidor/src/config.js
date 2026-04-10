function readEnv(name, { required = true, allowEmpty = false } = {}) {
  const value = process.env[name];

  if (!required) return value;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  if (!allowEmpty && String(value).trim() === "") {
    throw new Error(`Environment variable ${name} cannot be empty`);
  }

  return value;
}

function getServerConfig() {
  const cookieSecure = process.env.COOKIE_SECURE === "true";
  const cookieSameSite = process.env.COOKIE_SAME_SITE || "Lax";
  const trustProxy = process.env.TRUST_PROXY === "true";
  const tenantReservedSlugs = (process.env.TENANT_RESERVED_SLUGS || "www,api,app")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const tenantBaseDomains = (process.env.TENANT_BASE_DOMAINS || "localhost")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return {
    port: Number(process.env.PORT) || 4000,
    jwtSecret: readEnv("JWT_SECRET"),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
    loginRateLimitWindowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    loginRateLimitMaxAttempts: Number(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS) || 5,
    corsOrigins: (process.env.CORS_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    cookieName: process.env.COOKIE_NAME || "tuestilo_session",
    cookieDomain: process.env.COOKIE_DOMAIN || "",
    cookieSecure,
    cookieSameSite,
    trustProxy,
    defaultTenantSlug: process.env.DEFAULT_TENANT_SLUG || "tu-estilo-default",
    tenantHeaderName: process.env.TENANT_HEADER_NAME || "x-tenant-slug",
    tenantReservedSlugs,
    tenantBaseDomains,
    onboardingApiKey: process.env.ONBOARDING_API_KEY || "",
    platformAdminUsername: process.env.PLATFORM_ADMIN_USERNAME || "anthony",
    platformAdminPassword: process.env.PLATFORM_ADMIN_PASSWORD || "PoleWorkout%1",
    platformJwtExpiresIn: process.env.PLATFORM_JWT_EXPIRES_IN || "12h",
    storageProvider: process.env.STORAGE_PROVIDER || "local",
    r2AccountId: process.env.R2_ACCOUNT_ID || "",
    r2Bucket: process.env.R2_BUCKET || "",
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    r2PublicBaseUrl: process.env.R2_PUBLIC_BASE_URL || "",
    r2Region: process.env.R2_REGION || "auto",
    r2KeyPrefix: process.env.R2_KEY_PREFIX || "",
  };
}

function getDbConfig() {
  const sslCaBase64 = process.env.DB_SSL_CA_BASE64 || "";
  const sslRejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false";

  return {
    host: readEnv("DB_HOST"),
    port: Number(process.env.DB_PORT) || 3306,
    user: readEnv("DB_USER"),
    password: process.env.DB_PASSWORD || "",
    database: readEnv("DB_NAME"),
    ssl: sslCaBase64
      ? {
          ca: Buffer.from(sslCaBase64, "base64").toString("utf8"),
          rejectUnauthorized: sslRejectUnauthorized,
        }
      : null,
  };
}

module.exports = {
  getDbConfig,
  getServerConfig,
};

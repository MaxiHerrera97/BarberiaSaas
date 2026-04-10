const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { getServerConfig } = require("../config");

function normalizePrefix(prefix) {
  const p = String(prefix || "").trim();
  if (!p) return "";
  return p.replace(/^\/+|\/+$/g, "");
}

function normalizeBaseUrl(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  return s.replace(/\/+$/, "");
}

function buildObjectKey({ keyPrefix, folder, tenantId, ext }) {
  const safeFolder = String(folder || "").trim().replace(/^\/+|\/+$/g, "");
  const safeTenant = String(tenantId || "").trim();
  const fileName = `${Date.now()}-${randomUUID()}.${ext}`;
  const parts = [normalizePrefix(keyPrefix), safeFolder, safeTenant, fileName].filter(Boolean);
  return parts.join("/");
}

function getStorageProvider() {
  const cfg = getServerConfig();
  return String(cfg.storageProvider || "local").toLowerCase();
}

function getMissingR2Config(cfg) {
  const requiredFields = [
    ["R2_ACCOUNT_ID", cfg.r2AccountId],
    ["R2_BUCKET", cfg.r2Bucket],
    ["R2_ACCESS_KEY_ID", cfg.r2AccessKeyId],
    ["R2_SECRET_ACCESS_KEY", cfg.r2SecretAccessKey],
    ["R2_PUBLIC_BASE_URL", cfg.r2PublicBaseUrl],
  ];
  return requiredFields.filter(([, v]) => !String(v || "").trim()).map(([name]) => name);
}

function mapR2ErrorMessage(error) {
  const code = String(error?.name || error?.Code || error?.code || "").trim();
  const msg = String(error?.message || "").trim();
  const lowerMsg = msg.toLowerCase();

  if (code === "InvalidAccessKeyId" || code === "SignatureDoesNotMatch") {
    return "Credenciales R2 inválidas (Access Key / Secret). Revisar token S3 compatible.";
  }
  if (code === "AccessDenied") {
    return "Acceso denegado a R2. Revisar permisos del token (Object Read + Write) y bucket.";
  }
  if (code === "NoSuchBucket") {
    return "Bucket R2 inexistente o mal configurado. Revisar R2_BUCKET.";
  }
  if (lowerMsg.includes("getaddrinfo") || lowerMsg.includes("enotfound")) {
    return "No se pudo resolver endpoint de R2. Revisar R2_ACCOUNT_ID y conectividad.";
  }

  if (code) return `Error R2 (${code})`;
  if (msg) return `Error R2: ${msg}`;
  return "Error desconocido subiendo a R2";
}

async function uploadTenantImage({ tenantId, folder, buffer, ext = "webp", contentType = "image/webp" }) {
  const cfg = getServerConfig();
  const provider = getStorageProvider();

  if (provider !== "r2") {
    const key = buildObjectKey({ keyPrefix: "", folder, tenantId, ext });
    const absPath = path.resolve(__dirname, "..", "..", "uploads", key);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, buffer);
    return { provider: "local", key, url: `/uploads/${key}` };
  }

  const missingConfig = getMissingR2Config(cfg);
  if (missingConfig.length) {
    throw new Error(
      `R2 no configurado para STORAGE_PROVIDER=r2. Faltan variables: ${missingConfig.join(", ")}`
    );
  }

  let S3Client;
  let PutObjectCommand;
  try {
    ({ S3Client, PutObjectCommand } = require("@aws-sdk/client-s3"));
  } catch {
    throw new Error("Falta dependencia @aws-sdk/client-s3. Ejecuta npm install en servidor.");
  }

  const key = buildObjectKey({
    keyPrefix: cfg.r2KeyPrefix,
    folder,
    tenantId,
    ext,
  });

  const endpoint = `https://${cfg.r2AccountId}.r2.cloudflarestorage.com`;
  const client = new S3Client({
    region: cfg.r2Region || "auto",
    endpoint,
    credentials: {
      accessKeyId: cfg.r2AccessKeyId,
      secretAccessKey: cfg.r2SecretAccessKey,
    },
  });

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.r2Bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
  } catch (error) {
    throw new Error(mapR2ErrorMessage(error));
  }

  const base = normalizeBaseUrl(cfg.r2PublicBaseUrl);
  return { provider: "r2", key, url: `${base}/${key}` };
}

function getManagedLocalKeyFromUrl(url) {
  const s = String(url || "").trim();
  if (!s.startsWith("/uploads/")) return "";
  return s.replace(/^\/uploads\//, "");
}

function getManagedR2KeyFromUrl(url) {
  const cfg = getServerConfig();
  const base = normalizeBaseUrl(cfg.r2PublicBaseUrl);
  const s = String(url || "").trim();
  if (!base || !s.startsWith(`${base}/`)) return "";
  return s.slice(base.length + 1);
}

async function deleteManagedImageByUrl(url) {
  const cfg = getServerConfig();
  const provider = getStorageProvider();
  const localKey = getManagedLocalKeyFromUrl(url);

  if (localKey) {
    const absPath = path.resolve(__dirname, "..", "..", "uploads", localKey);
    await fs.unlink(absPath).catch(() => {});
    return;
  }

  if (provider !== "r2") return;
  const key = getManagedR2KeyFromUrl(url);
  if (!key) return;

  if (!cfg.r2AccountId || !cfg.r2Bucket || !cfg.r2AccessKeyId || !cfg.r2SecretAccessKey) return;

  let S3Client;
  let DeleteObjectCommand;
  try {
    ({ S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3"));
  } catch {
    return;
  }

  const endpoint = `https://${cfg.r2AccountId}.r2.cloudflarestorage.com`;
  const client = new S3Client({
    region: cfg.r2Region || "auto",
    endpoint,
    credentials: {
      accessKeyId: cfg.r2AccessKeyId,
      secretAccessKey: cfg.r2SecretAccessKey,
    },
  });

  await client
    .send(
      new DeleteObjectCommand({
        Bucket: cfg.r2Bucket,
        Key: key,
      })
    )
    .catch(() => {});
}

module.exports = {
  uploadTenantImage,
  deleteManagedImageByUrl,
};

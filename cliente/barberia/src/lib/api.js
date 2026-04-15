import { resolveTenantSlug } from "./tenant";
import { getToken } from "./auth";
import { getPlatformToken } from "./platformAuth";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const DEBUG_API = import.meta.env.VITE_DEBUG_API === "true";
const TENANT_SLUG = resolveTenantSlug();

export function getApiUrl() {
  return API_URL;
}

async function sendJson(path, { token, method = "GET", body, platform = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  const authToken = token || (platform ? getPlatformToken() : getToken());
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (!platform && TENANT_SLUG) headers["X-Tenant-Slug"] = TENANT_SLUG;

  if (DEBUG_API) {
    console.log(platform ? "PLATFORM FETCH ->" : "API FETCH ->", `${API_URL}${path}`, method);
  }

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err = new Error(
      "No se pudo conectar con el servidor. Revisá la URL de API, CORS y que el backend esté activo."
    );
    err.code = "NETWORK_ERROR";
    err.status = 0;
    err.payload = null;
    throw err;
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.code = data?.code || "";
    err.status = res.status;
    err.payload = data || null;
    throw err;
  }

  return data;
}

export async function apiFetch(path, { token, method = "GET", body } = {}) {
  return sendJson(path, { token, method, body, platform: false });
}

export async function platformFetch(path, { token, method = "GET", body } = {}) {
  return sendJson(path, { token, method, body, platform: true });
}

import { resolveTenantSlug } from "./tenant";
import { getToken } from "./auth";
import { getPlatformToken } from "./platformAuth";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const DEBUG_API = import.meta.env.VITE_DEBUG_API === "true";
const TENANT_SLUG = resolveTenantSlug();

export function getApiUrl() {
  return API_URL;
}

export async function apiFetch(path, { token, method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const authToken = token || getToken();
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (TENANT_SLUG) headers["X-Tenant-Slug"] = TENANT_SLUG;

  if (DEBUG_API) {
    console.log("API FETCH ->", `${API_URL}${path}`, method);
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });

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

export async function platformFetch(path, { token, method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const authToken = token || getPlatformToken();
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  if (DEBUG_API) {
    console.log("PLATFORM FETCH ->", `${API_URL}${path}`, method);
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });

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

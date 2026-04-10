const RESERVED_SLUGS = new Set(["www", "api", "app"]);

export function getTenantSlugFromHostname(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return null;
  if (host === "localhost") return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;

  const parts = host.split(".").filter(Boolean);
  const isLocalhostDomain = parts[parts.length - 1] === "localhost";

  if (!isLocalhostDomain && parts.length < 3) return null;
  if (isLocalhostDomain && parts.length < 2) return null;

  const subdomain = parts[0];
  if (!subdomain || RESERVED_SLUGS.has(subdomain)) return null;
  return subdomain;
}

export function resolveTenantSlug() {
  const envTenant = (import.meta.env.VITE_TENANT_SLUG || "").trim().toLowerCase();
  if (envTenant) return envTenant;

  if (typeof window === "undefined") return "";
  return getTenantSlugFromHostname(window.location.hostname) || "";
}

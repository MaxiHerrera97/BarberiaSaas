function getTenantSlugFromHost(hostHeader = "", { reservedSlugs = [], baseDomains = [] } = {}) {
  const host = String(hostHeader || "").split(",")[0].split(":")[0].trim().toLowerCase();
  if (!host) return null;
  if (host === "localhost") return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;

  const normalizedBaseDomains = Array.isArray(baseDomains)
    ? baseDomains.map((d) => String(d || "").trim().toLowerCase()).filter(Boolean)
    : [];

  const candidates = normalizedBaseDomains.length ? normalizedBaseDomains : ["localhost"];
  let subdomain = "";
  for (const base of candidates) {
    if (host === base) continue;
    if (!host.endsWith(`.${base}`)) continue;

    const prefix = host.slice(0, -(base.length + 1));
    if (!prefix) continue;
    subdomain = prefix.split(".")[0];
    break;
  }

  if (!subdomain) return null;

  const blocked = new Set(["www", ...reservedSlugs]);
  if (blocked.has(subdomain)) return null;

  return subdomain;
}

module.exports = {
  getTenantSlugFromHost,
};

function parseCookies(header = "") {
  return String(header)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const eqIdx = part.indexOf("=");
      if (eqIdx <= 0) return acc;
      const key = decodeURIComponent(part.slice(0, eqIdx).trim());
      const value = decodeURIComponent(part.slice(eqIdx + 1).trim());
      acc[key] = value;
      return acc;
    }, {});
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.expires instanceof Date) parts.push(`Expires=${options.expires.toUTCString()}`);

  return parts.join("; ");
}

module.exports = {
  parseCookies,
  serializeCookie,
};

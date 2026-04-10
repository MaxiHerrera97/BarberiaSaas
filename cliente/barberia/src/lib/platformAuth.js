const KEY = "tuestilo_platform_session";

export function savePlatformSession(session) {
  localStorage.setItem(KEY, JSON.stringify(session || null));
}

export function loadPlatformSession() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.token !== "string" || !parsed.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPlatformSession() {
  localStorage.removeItem(KEY);
}

export function getPlatformToken() {
  return loadPlatformSession()?.token || "";
}

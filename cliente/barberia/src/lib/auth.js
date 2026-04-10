const KEY = "tuestilo_session";
const VALID_ROLES = new Set(["admin", "barber"]);

function isValidSession(session) {
  if (!session || typeof session !== "object") return false;
  if (!session.name || typeof session.name !== "string") return false;
  if (!VALID_ROLES.has(session.role)) return false;
  if (session.token !== undefined && typeof session.token !== "string") return false;
  return true;
}

export function saveSession(session) {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!isValidSession(parsed)) {
      clearSession();
      return null;
    }
    return parsed;
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

export function getToken() {
  return loadSession()?.token || null;
}

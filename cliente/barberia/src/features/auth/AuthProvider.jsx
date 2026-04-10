import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { clearSession, loadSession, saveSession } from "../../lib/auth";
import { AuthContext } from "./auth-context";

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => loadSession());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function bootstrap() {
      try {
        const data = await apiFetch("/auth/me");
        const current = loadSession();
        const nextSession = {
          token: current?.token || "",
          userId: data.user.id,
          tenantId: data.user.tenantId,
          name: data.user.name,
          role: data.user.role,
          barberId: data.user.barberId,
          branchId: data.user.branchId,
        };

        if (!alive) return;
        saveSession(nextSession);
        setSession(nextSession);
      } catch {
        if (!alive) return;
        clearSession();
        setSession(null);
      } finally {
        if (alive) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      alive = false;
    };
  }, []);

  const value = useMemo(
    () => ({
      session,
      loading,
      setSession,
      clearAuth() {
        clearSession();
        setSession(null);
      },
      persistSession(nextSession) {
        saveSession(nextSession);
        setSession(nextSession);
      },
    }),
    [loading, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

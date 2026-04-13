import { Link, Navigate } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../auth/auth-context";

import Container from "../../components/Container";
import BarberRankingCard from "./BarberRankingCard";

export default function AdminRankingPage() {
  const { session, clearAuth, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-[40vh] grid place-items-center text-sm text-zinc-400">
        Verificando sesión...
      </div>
    );
  }

  // ✅ si no hay sesión, afuera
  if (!session) {
    return <Navigate to="/login" replace />;
  }

  async function logout() {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // best-effort
    } finally {
      clearAuth();
      window.location.href = "/login";
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-zinc-950/80 backdrop-blur">
        <Container className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm text-zinc-400">Panel</div>
            <div className="text-lg font-black">Ranking mensual</div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              onClick={logout}
              className="rounded-xl px-4 py-2 text-sm font-semibold hover:bg-white/10 max-[420px]:w-full"
            >
              Cerrar sesión
            </button>

            <Link
              to="/admin"
              className="rounded-xl px-4 py-2 text-sm font-semibold hover:bg-white/10 max-[420px]:w-full text-center"
            >
              Volver a agenda
            </Link>

            <Link
              to="/"
              className="rounded-xl px-4 py-2 text-sm font-semibold hover:bg-white/10 max-[420px]:w-full text-center"
            >
              Volver al sitio
            </Link>

            <div className="hidden md:block text-xs text-zinc-400">
              Sesión:{" "}
              <span className="text-zinc-200 font-semibold">
                {session?.name}
              </span>
            </div>
          </div>
        </Container>
      </header>

      <Container className="py-10">
        <div className="w-full max-w-3xl">
          <BarberRankingCard />
        </div>

        <div className="mt-6 rounded-2xl bg-zinc-900/40 ring-1 ring-white/10 p-4 text-sm text-zinc-400">
          {session?.role === "barber" ? (
            <div className="mb-2 rounded-lg bg-zinc-900/70 px-3 py-2 text-xs text-zinc-300 ring-1 ring-white/10">
              Vista barbero: se muestran solo tus turnos finalizados.
            </div>
          ) : null}
          * Se cuentan solo los turnos finalizados.  
          * Muestra facturación estimada y detalle de servicios por barbero.  
          * Calcula comisión estimada según el % configurado por barbero.  
          * Incluye historial de los últimos 6 meses.
        </div>
      </Container>
    </div>
  );
}

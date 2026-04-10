import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Container from "../../components/Container";
import Button from "../../ui/Button";
import { apiFetch } from "../../lib/api";
import { useAuth } from "./auth-context";

export default function LoginPage() {
  const nav = useNavigate();
  const location = useLocation();
  const { persistSession } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");

    try {
      const data = await apiFetch("/auth/login", {
        method: "POST",
        body: { username, password },
      });

      persistSession({
        token: data.token,
        userId: data.user.id,
        tenantId: data.user.tenantId,
        name: data.user.name,
        role: data.user.role,
        barberId: data.user.barberId,
        branchId: data.user.branchId,
      });

      const nextPath =
        typeof location.state?.from === "string" ? location.state.from : "/admin";
      nav(nextPath, { replace: true });
    } catch (e) {
      setErr(e.message || "Error login");
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-30"
        style={{ backgroundImage: "url('/hero/hero2.jpg')" }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.18),transparent_36%),linear-gradient(180deg,rgba(9,9,11,0.45),rgba(9,9,11,0.92))]" />

      <Container className="relative flex min-h-screen items-center justify-center py-8 sm:py-12">
        <div className="w-full max-w-md rounded-[28px] bg-zinc-950/78 p-4 shadow-2xl ring-1 ring-white/10 backdrop-blur-md sm:p-6">
          <div className="rounded-2xl border border-white/8 bg-zinc-900/55 p-5 sm:p-6">
            <div className="inline-flex rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold tracking-[0.2em] text-amber-300 uppercase">
              Panel interno
            </div>

            <h1 className="mt-4 text-2xl font-black sm:text-3xl">Ingreso</h1>
            <p className="mt-2 text-sm text-zinc-400">
              Administrá turnos, agenda y operación diaria de Tu Estilo - Barbería.
            </p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Usuario</label>
                <input
                  className="w-full rounded-xl bg-zinc-950/70 px-3 py-2.5 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Tu usuario"
                  autoComplete="username"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-zinc-400">
                  Contraseña
                </label>
                <input
                  type="password"
                  className="w-full rounded-xl bg-zinc-950/70 px-3 py-2.5 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Tu contraseña"
                  autoComplete="current-password"
                />
              </div>

              {err && (
                <div className="rounded-xl bg-red-500/10 ring-1 ring-red-500/30 px-3 py-2 text-sm text-red-200">
                  {err}
                </div>
              )}

              <Button type="submit" className="mt-2 w-full py-2.5">
                Entrar
              </Button>
            </form>
          </div>
        </div>
      </Container>
    </div>
  );
}

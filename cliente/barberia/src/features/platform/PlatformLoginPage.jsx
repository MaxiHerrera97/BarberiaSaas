import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Container from "../../components/Container";
import Button from "../../ui/Button";
import { platformFetch } from "../../lib/api";
import { savePlatformSession } from "../../lib/platformAuth";

export default function PlatformLoginPage() {
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await platformFetch("/platform/auth/login", {
        method: "POST",
        body: { username, password },
      });
      savePlatformSession({
        token: data.token,
        username: data.user?.username || username,
      });
      nav("/platform", { replace: true });
    } catch (e) {
      setError(e.message || "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Container className="flex min-h-screen items-center justify-center py-10">
        <div className="w-full max-w-md rounded-3xl bg-zinc-900/70 p-6 ring-1 ring-white/10">
          <h1 className="text-2xl font-black">Panel Maestro</h1>
          <p className="mt-2 text-sm text-zinc-400">Ingreso de administrador de plataforma</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Usuario</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-xl bg-zinc-950 px-3 py-2 ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-amber-400"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl bg-zinc-950 px-3 py-2 ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-amber-400"
                autoComplete="current-password"
              />
            </div>

            {error ? (
              <div className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
            ) : null}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Ingresando..." : "Entrar al panel"}
            </Button>
          </form>
        </div>
      </Container>
    </div>
  );
}

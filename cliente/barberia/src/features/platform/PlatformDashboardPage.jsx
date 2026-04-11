import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Container from "../../components/Container";
import { platformFetch } from "../../lib/api";
import { clearPlatformSession, loadPlatformSession } from "../../lib/platformAuth";

function formatMoney(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function toSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function suggestUsernameFromName(value) {
  const base = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 48);
  return base || "barbero";
}

function buildTenantPublicUrl(tenantSlug, baseDomain) {
  const slug = String(tenantSlug || "").trim().toLowerCase();
  const domain = String(baseDomain || "localhost").trim().toLowerCase();
  if (!slug || !domain) return "";
  if (domain === "localhost") return `http://${slug}.localhost:5173`;
  return `https://${slug}.${domain}`;
}

export default function PlatformDashboardPage() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState(null);
  const [payingId, setPayingId] = useState(0);
  const [togglingId, setTogglingId] = useState(0);
  const [deletingTenantId, setDeletingTenantId] = useState(0);
  const [togglingMultiBranchId, setTogglingMultiBranchId] = useState(0);
  const [removingPaymentId, setRemovingPaymentId] = useState(0);
  const [methodByTenant, setMethodByTenant] = useState({});
  const [okMsg, setOkMsg] = useState("");
  const [openTenantId, setOpenTenantId] = useState(0);
  const [loadingOverviewId, setLoadingOverviewId] = useState(0);
  const [overviewByTenant, setOverviewByTenant] = useState({});
  const [savingUserId, setSavingUserId] = useState(0);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [creatingUserTenantId, setCreatingUserTenantId] = useState(0);
  const [newUserByTenant, setNewUserByTenant] = useState({});
  const [platformConfig, setPlatformConfig] = useState({
    tenantBaseDomains: ["localhost"],
    defaultPlan: "free",
    defaultTimezone: "America/Argentina/Buenos_Aires",
  });
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboarding, setOnboarding] = useState({
    tenantName: "",
    tenantSlug: "",
    tenantPlan: "free",
    timezone: "America/Argentina/Buenos_Aires",
    adminName: "",
    adminUsername: "",
    adminPassword: "",
  });

  const session = loadPlatformSession();
  const tenants = useMemo(() => overview?.tenants || [], [overview]);
  const firstBaseDomain = platformConfig.tenantBaseDomains?.[0] || "localhost";

  useEffect(() => {
    if (!session?.token) {
      nav("/platform/login", { replace: true });
      return;
    }
    let alive = true;
    async function bootstrap() {
      try {
        await platformFetch("/platform/auth/me");
        const [data, audit] = await Promise.all([
          platformFetch("/platform/billing/overview"),
          platformFetch("/platform/audit?limit=50"),
        ]);
        const cfg = await platformFetch("/platform/config");
        if (!alive) return;
        setOverview(data);
        setAuditLogs(Array.isArray(audit?.logs) ? audit.logs : []);
        setPlatformConfig({
          tenantBaseDomains:
            Array.isArray(cfg?.tenantBaseDomains) && cfg.tenantBaseDomains.length
              ? cfg.tenantBaseDomains
              : ["localhost"],
          defaultPlan: cfg?.defaultPlan || "free",
          defaultTimezone: cfg?.defaultTimezone || "America/Argentina/Buenos_Aires",
        });
        setOnboarding((prev) => ({
          ...prev,
          tenantPlan: cfg?.defaultPlan || "free",
          timezone: cfg?.defaultTimezone || "America/Argentina/Buenos_Aires",
        }));
        setMethodByTenant(
          Object.fromEntries((data.tenants || []).map((t) => [t.id, "transferencia"]))
        );
      } catch {
        if (!alive) return;
        clearPlatformSession();
        nav("/platform/login", { replace: true });
      } finally {
        if (alive) setLoading(false);
      }
    }
    bootstrap();
    return () => {
      alive = false;
    };
  }, [nav, session?.token]);

  function markOk(msg) {
    setOkMsg(msg);
    setTimeout(() => setOkMsg(""), 2500);
  }

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [data, audit] = await Promise.all([
        platformFetch("/platform/billing/overview"),
        platformFetch("/platform/audit?limit=50"),
      ]);
      setOverview(data);
      setAuditLogs(Array.isArray(audit?.logs) ? audit.logs : []);
    } catch (e) {
      setError(e.message || "No se pudo refrescar el dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function refreshAuditOnly() {
    setLoadingAudit(true);
    try {
      const audit = await platformFetch("/platform/audit?limit=50");
      setAuditLogs(Array.isArray(audit?.logs) ? audit.logs : []);
    } catch {
      // keep current logs
    } finally {
      setLoadingAudit(false);
    }
  }

  async function logout() {
    try {
      await platformFetch("/platform/auth/logout", { method: "POST" });
    } catch {
      // best effort
    } finally {
      clearPlatformSession();
      nav("/platform/login", { replace: true });
    }
  }

  async function registerPayment(tenant) {
    setPayingId(tenant.id);
    setError("");
    try {
      await platformFetch(`/platform/tenants/${tenant.id}/payments`, {
        method: "POST",
        body: {
          billingMonth: tenant.billingMonth,
          paymentMethod: methodByTenant[tenant.id] || "transferencia",
          amountArs: overview?.billing?.monthlyFeeArs || 30000,
          notes: "Registrado desde Panel Maestro",
          recordedBy: session?.username || "platform-admin",
        },
      });
      markOk(`Pago registrado para ${tenant.name}`);
      await refresh();
    } catch (e) {
      setError(e.message || "No se pudo registrar pago");
    } finally {
      setPayingId(0);
    }
  }

  async function removePayment(tenant) {
    setRemovingPaymentId(tenant.id);
    setError("");
    try {
      await platformFetch(
        `/platform/tenants/${tenant.id}/payments/${tenant.billingMonth}`,
        { method: "DELETE" }
      );
      markOk(`Pago eliminado para ${tenant.name}`);
      await refresh();
    } catch (e) {
      setError(e.message || "No se pudo eliminar pago");
    } finally {
      setRemovingPaymentId(0);
    }
  }

  async function toggleTenantStatus(tenant) {
    const nextStatus = tenant.status === "active" ? "inactive" : "active";
    setTogglingId(tenant.id);
    setError("");
    try {
      await platformFetch(`/platform/tenants/${tenant.id}/status`, {
        method: "PATCH",
        body: { status: nextStatus },
      });
      markOk(
        nextStatus === "active"
          ? `${tenant.name} fue activado`
          : `${tenant.name} fue inactivado`
      );
      await refresh();
    } catch (e) {
      setError(e.message || "No se pudo cambiar estado");
    } finally {
      setTogglingId(0);
    }
  }

  async function toggleMultiBranch(tenant) {
    const nextValue = !tenant.multiBranchEnabled;
    setTogglingMultiBranchId(tenant.id);
    setError("");
    try {
      await platformFetch(`/platform/tenants/${tenant.id}/multi-branch`, {
        method: "PATCH",
        body: { enabled: nextValue },
      });
      markOk(
        nextValue
          ? `Multi-sucursal habilitado para ${tenant.name}`
          : `Multi-sucursal deshabilitado para ${tenant.name}`
      );
      await refresh();
    } catch (e) {
      setError(e.message || "No se pudo actualizar multi-sucursal");
    } finally {
      setTogglingMultiBranchId(0);
    }
  }

  async function deleteTenantPermanent(tenant) {
    const tenantSlug = String(tenant?.slug || "").trim();
    const typed = window.prompt(
      `Vas a eliminar definitivamente el tenant "${tenantSlug}". Escribí el slug para confirmar:`,
      ""
    );
    if (typed === null) return;
    if (String(typed || "").trim().toLowerCase() !== tenantSlug.toLowerCase()) {
      setError("Confirmación inválida. No se eliminó el tenant.");
      return;
    }

    setDeletingTenantId(tenant.id);
    setError("");
    try {
      await platformFetch(`/platform/tenants/${tenant.id}/permanent`, {
        method: "DELETE",
      });
      markOk(`Tenant eliminado definitivamente: ${tenant.name}`);
      if (openTenantId === tenant.id) setOpenTenantId(0);
      setOverviewByTenant((prev) => {
        const next = { ...prev };
        delete next[tenant.id];
        return next;
      });
      setNewUserByTenant((prev) => {
        const next = { ...prev };
        delete next[tenant.id];
        return next;
      });
      await refresh();
      refreshAuditOnly();
    } catch (e) {
      setError(e.message || "No se pudo eliminar tenant definitivamente");
    } finally {
      setDeletingTenantId(0);
    }
  }

  async function toggleOverview(tenant) {
    if (openTenantId === tenant.id) {
      setOpenTenantId(0);
      return;
    }

    setOpenTenantId(tenant.id);
    if (overviewByTenant[tenant.id]) return;

    setLoadingOverviewId(tenant.id);
    setError("");
    try {
      const detail = await platformFetch(`/platform/tenants/${tenant.id}/overview`);
      setOverviewByTenant((prev) => ({ ...prev, [tenant.id]: detail }));
      setNewUserByTenant((prev) => ({
        ...prev,
        [tenant.id]: prev[tenant.id] || {
          fullName: "",
          username: "",
          role: "barber",
          barberId: "",
          password: "",
        },
      }));
    } catch (e) {
      setError(e.message || "No se pudo cargar el detalle del tenant");
    } finally {
      setLoadingOverviewId(0);
    }
  }

  async function updateUserStatus(tenantId, userId, isActive) {
    setSavingUserId(userId);
    setError("");
    try {
      await platformFetch(`/platform/tenants/${tenantId}/users/${userId}/status`, {
        method: "PATCH",
        body: { isActive },
      });
      setOverviewByTenant((prev) => {
        const current = prev[tenantId];
        if (!current) return prev;
        return {
          ...prev,
          [tenantId]: {
            ...current,
            userAccounts: (current.userAccounts || []).map((u) =>
              u.id === userId ? { ...u, is_active: isActive ? 1 : 0 } : u
            ),
          },
        };
      });
      markOk(isActive ? "Usuario activado" : "Usuario inactivado");
      refreshAuditOnly();
    } catch (e) {
      setError(e.message || "No se pudo actualizar usuario");
    } finally {
      setSavingUserId(0);
    }
  }

  async function resetUserPassword(tenantId, userId, username) {
    const custom = window.prompt(
      `Nueva contraseña para ${username} (deja vacío para generar automática):`,
      ""
    );
    if (custom === null) return;
    setSavingUserId(userId);
    setError("");
    try {
      const resp = await platformFetch(`/platform/tenants/${tenantId}/users/${userId}/reset-password`, {
        method: "POST",
        body: custom.trim() ? { newPassword: custom.trim() } : {},
      });
      markOk(`Contraseña actualizada para ${username}: ${resp.newPassword}`);
      refreshAuditOnly();
    } catch (e) {
      setError(e.message || "No se pudo resetear contraseña");
    } finally {
      setSavingUserId(0);
    }
  }

  async function deleteBarberUser(tenantId, userId, username) {
    const yes = window.confirm(
      `¿Seguro que querés eliminar definitivamente el usuario ${username}? Esta acción no se puede deshacer.`
    );
    if (!yes) return;

    setSavingUserId(userId);
    setError("");
    try {
      await platformFetch(`/platform/tenants/${tenantId}/users/${userId}`, {
        method: "DELETE",
      });
      const refreshed = await platformFetch(`/platform/tenants/${tenantId}/overview`);
      setOverviewByTenant((prev) => ({ ...prev, [tenantId]: refreshed }));
      markOk(`Usuario ${username} eliminado`);
      refreshAuditOnly();
    } catch (e) {
      setError(e.message || "No se pudo eliminar usuario");
    } finally {
      setSavingUserId(0);
    }
  }

  async function createTenantUser(tenant) {
    const draft = newUserByTenant[tenant.id] || {};
    setCreatingUserTenantId(tenant.id);
    setError("");
    try {
      await platformFetch(`/platform/tenants/${tenant.id}/users`, {
        method: "POST",
        body: {
          fullName: String(draft.fullName || "").trim(),
          username: String(draft.username || "").trim().toLowerCase(),
          role: draft.role || "barber",
          barberId: draft.role === "barber" ? Number(draft.barberId) : null,
          password: String(draft.password || ""),
        },
      });

      const refreshed = await platformFetch(`/platform/tenants/${tenant.id}/overview`);
      setOverviewByTenant((prev) => ({ ...prev, [tenant.id]: refreshed }));
      setNewUserByTenant((prev) => ({
        ...prev,
        [tenant.id]: {
          fullName: "",
          username: "",
          role: "barber",
          barberId: "",
          password: "",
        },
      }));
      markOk("Usuario creado correctamente");
      refreshAuditOnly();
    } catch (e) {
      setError(e.message || "No se pudo crear usuario");
    } finally {
      setCreatingUserTenantId(0);
    }
  }

  async function createTenant() {
    setError("");
    setOnboardingLoading(true);
    try {
      const tenantSlug = toSlug(onboarding.tenantSlug || onboarding.tenantName);
      const adminUsername = String(onboarding.adminUsername || "").trim().toLowerCase();
      const payload = {
        tenantSlug,
        tenantName: String(onboarding.tenantName || "").trim(),
        tenantPlan: onboarding.tenantPlan || "free",
        timezone: onboarding.timezone || "America/Argentina/Buenos_Aires",
        adminName: String(onboarding.adminName || "").trim(),
        adminUsername,
        adminPassword: String(onboarding.adminPassword || ""),
      };

      await platformFetch("/platform/tenants/onboard", {
        method: "POST",
        body: payload,
      });

      const baseDomain = platformConfig.tenantBaseDomains?.[0] || "localhost";
      markOk(`Tenant creado: https://${tenantSlug}.${baseDomain}`);
      setOnboarding({
        tenantName: "",
        tenantSlug: "",
        tenantPlan: platformConfig.defaultPlan || "free",
        timezone: platformConfig.defaultTimezone || "America/Argentina/Buenos_Aires",
        adminName: "",
        adminUsername: "",
        adminPassword: "",
      });
      await refresh();
      refreshAuditOnly();
    } catch (e) {
      setError(e.message || "No se pudo crear tenant");
    } finally {
      setOnboardingLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-zinc-950 text-sm text-zinc-400">
        Cargando panel maestro...
      </div>
    );
  }

  const summary = overview?.summary || {};

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-zinc-950/85 backdrop-blur">
        <Container className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-400">Panel Maestro</div>
            <div className="text-xl font-black">Tenants y Cobros</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={refresh}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold ring-1 ring-white/10 hover:bg-zinc-800"
            >
              Actualizar
            </button>
            <button
              onClick={logout}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold ring-1 ring-white/10 hover:bg-zinc-800"
            >
              Cerrar sesión
            </button>
          </div>
        </Container>
      </header>

      <Container className="space-y-6 py-8">
        {error ? (
          <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
        ) : null}
        {okMsg ? (
          <div className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{okMsg}</div>
        ) : null}

        <section className="rounded-2xl bg-zinc-900/45 p-4 ring-1 ring-white/10">
          <h3 className="mb-1 text-base font-bold">Alta de Barbería</h3>
          <p className="mb-3 text-xs text-zinc-400">
            Dominio base activo:{" "}
            <span className="font-semibold text-zinc-200">
              {(platformConfig.tenantBaseDomains || []).join(", ")}
            </span>
          </p>
          <div className="grid gap-2 md:grid-cols-4">
            <input
              value={onboarding.tenantName}
              onChange={(e) =>
                setOnboarding((prev) => ({ ...prev, tenantName: e.target.value }))
              }
              placeholder="Nombre barbería"
              className="rounded-xl bg-zinc-950 px-3 py-2 text-sm ring-1 ring-white/10"
            />
            <input
              value={onboarding.tenantSlug}
              onChange={(e) =>
                setOnboarding((prev) => ({ ...prev, tenantSlug: toSlug(e.target.value) }))
              }
              placeholder="slug (opcional)"
              className="rounded-xl bg-zinc-950 px-3 py-2 text-sm ring-1 ring-white/10"
            />
            <input
              value={onboarding.adminName}
              onChange={(e) =>
                setOnboarding((prev) => ({ ...prev, adminName: e.target.value }))
              }
              placeholder="Nombre admin"
              className="rounded-xl bg-zinc-950 px-3 py-2 text-sm ring-1 ring-white/10"
            />
            <input
              value={onboarding.adminUsername}
              onChange={(e) =>
                setOnboarding((prev) => ({
                  ...prev,
                  adminUsername: e.target.value.toLowerCase(),
                }))
              }
              placeholder="Usuario admin"
              className="rounded-xl bg-zinc-950 px-3 py-2 text-sm ring-1 ring-white/10"
            />
            <input
              type="password"
              value={onboarding.adminPassword}
              onChange={(e) =>
                setOnboarding((prev) => ({ ...prev, adminPassword: e.target.value }))
              }
              placeholder="Clave admin"
              className="rounded-xl bg-zinc-950 px-3 py-2 text-sm ring-1 ring-white/10"
            />
            <select
              value={onboarding.tenantPlan}
              onChange={(e) =>
                setOnboarding((prev) => ({ ...prev, tenantPlan: e.target.value }))
              }
              className="rounded-xl bg-zinc-950 px-3 py-2 text-sm ring-1 ring-white/10"
            >
              <option value="free">free</option>
              <option value="basic">basic</option>
              <option value="pro">pro</option>
            </select>
            <input
              value={onboarding.timezone}
              onChange={(e) =>
                setOnboarding((prev) => ({ ...prev, timezone: e.target.value }))
              }
              placeholder="Timezone"
              className="rounded-xl bg-zinc-950 px-3 py-2 text-sm ring-1 ring-white/10"
            />
            <button
              onClick={createTenant}
              disabled={onboardingLoading}
              className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-60"
            >
              {onboardingLoading ? "Creando..." : "Crear barbería"}
            </button>
          </div>
          <div className="mt-2 text-xs text-zinc-400">
            URL estimada:{" "}
            <span className="font-semibold text-zinc-200">
              https://{toSlug(onboarding.tenantSlug || onboarding.tenantName) || "<slug>"}.
              {platformConfig.tenantBaseDomains?.[0] || "localhost"}
            </span>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl bg-zinc-900/60 p-4 ring-1 ring-white/10">
            <div className="text-xs text-zinc-400">Tenants totales</div>
            <div className="mt-1 text-2xl font-black">{summary.totalTenants || 0}</div>
          </div>
          <div className="rounded-2xl bg-zinc-900/60 p-4 ring-1 ring-white/10">
            <div className="text-xs text-zinc-400">Pagaron mes actual</div>
            <div className="mt-1 text-2xl font-black text-emerald-300">{summary.paidCount || 0}</div>
          </div>
          <div className="rounded-2xl bg-zinc-900/60 p-4 ring-1 ring-white/10">
            <div className="text-xs text-zinc-400">No pagaron</div>
            <div className="mt-1 text-2xl font-black text-amber-300">{summary.unpaidCount || 0}</div>
          </div>
          <div className="rounded-2xl bg-zinc-900/60 p-4 ring-1 ring-white/10">
            <div className="text-xs text-zinc-400">Suspendidos por pago</div>
            <div className="mt-1 text-2xl font-black text-red-300">
              {summary.suspendedByPaymentCount || 0}
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-white/10">
          <div className="grid gap-2 text-sm md:grid-cols-3">
            <div>
              Esperado:{" "}
              <span className="font-semibold text-zinc-200">
                {formatMoney(summary.expectedRevenueArs)}
              </span>
            </div>
            <div>
              Cobrado:{" "}
              <span className="font-semibold text-emerald-300">
                {formatMoney(summary.collectedRevenueArs)}
              </span>
            </div>
            <div>
              Pendiente:{" "}
              <span className="font-semibold text-amber-300">
                {formatMoney(summary.pendingRevenueArs)}
              </span>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          {tenants.map((tenant) => (
            <article key={tenant.id} className="rounded-2xl bg-zinc-900/45 p-4 ring-1 ring-white/10">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-lg font-bold">{tenant.name}</div>
                  <div className="text-sm text-zinc-400">
                    #{tenant.id} · {tenant.slug} · estado {tenant.status}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    Mes: {tenant.billingMonth} · multi-sucursal:{" "}
                    {tenant.multiBranchEnabled ? "habilitado" : "deshabilitado"}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    URL: {buildTenantPublicUrl(tenant.slug, firstBaseDomain)}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={[
                      "rounded-lg px-2 py-1 text-xs font-semibold",
                      tenant.currentMonthPaid
                        ? "bg-emerald-500/20 text-emerald-200"
                        : "bg-amber-500/20 text-amber-200",
                    ].join(" ")}
                  >
                    {tenant.currentMonthPaid ? "Pago registrado" : "Sin pago"}
                  </span>

                  {tenant.suspendedByPayment ? (
                    <span className="rounded-lg bg-red-500/20 px-2 py-1 text-xs font-semibold text-red-200">
                      Suspendido por pago
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
                <select
                  value={methodByTenant[tenant.id] || "transferencia"}
                  onChange={(e) =>
                    setMethodByTenant((prev) => ({ ...prev, [tenant.id]: e.target.value }))
                  }
                  className="rounded-xl bg-zinc-950 px-3 py-2 text-sm ring-1 ring-white/10"
                >
                  <option value="transferencia">Transferencia</option>
                  <option value="mercado_pago">Mercado Pago</option>
                  <option value="efectivo">Efectivo</option>
                </select>

                <button
                  onClick={() => registerPayment(tenant)}
                  disabled={payingId === tenant.id}
                  className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-60"
                >
                  {payingId === tenant.id ? "Registrando..." : "Registrar pago"}
                </button>

                {tenant.currentMonthPaid ? (
                  <button
                    onClick={() => removePayment(tenant)}
                    disabled={removingPaymentId === tenant.id}
                    className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:opacity-60"
                  >
                    {removingPaymentId === tenant.id ? "Eliminando..." : "Quitar pago"}
                  </button>
                ) : null}

                <button
                  onClick={() => toggleMultiBranch(tenant)}
                  disabled={togglingMultiBranchId === tenant.id}
                  className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:opacity-60"
                >
                  {togglingMultiBranchId === tenant.id
                    ? "Guardando..."
                    : tenant.multiBranchEnabled
                    ? "Deshabilitar multi-sucursal"
                    : "Habilitar multi-sucursal"}
                </button>

                <button
                  onClick={() => toggleTenantStatus(tenant)}
                  disabled={togglingId === tenant.id}
                  className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:opacity-60"
                >
                  {togglingId === tenant.id
                    ? "Guardando..."
                    : tenant.status === "active"
                    ? "Inactivar"
                    : "Activar"}
                </button>

                {tenant.status !== "active" ? (
                  <button
                    onClick={() => deleteTenantPermanent(tenant)}
                    disabled={deletingTenantId === tenant.id}
                    className="rounded-xl bg-red-600/80 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {deletingTenantId === tenant.id ? "Eliminando..." : "Eliminar definitivo"}
                  </button>
                ) : null}

                <button
                  onClick={() => toggleOverview(tenant)}
                  className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-100"
                >
                  {openTenantId === tenant.id ? "Ocultar detalle" : "Ver detalle"}
                </button>

                <a
                  href={buildTenantPublicUrl(tenant.slug, firstBaseDomain)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-100"
                >
                  Abrir sitio
                </a>
              </div>

              {openTenantId === tenant.id ? (
                <div className="mt-4 rounded-xl bg-zinc-950/50 p-4 ring-1 ring-white/10">
                  {loadingOverviewId === tenant.id ? (
                    <div className="text-sm text-zinc-400">Cargando detalle...</div>
                  ) : (
                    (() => {
                      const detail = overviewByTenant[tenant.id];
                      if (!detail) {
                        return (
                          <div className="text-sm text-zinc-400">
                            Sin detalle disponible.
                          </div>
                        );
                      }

                      const counts = detail.counts || {};
                      const stats = detail.appointmentStats || {};
                      const users = Array.isArray(detail.userAccounts) ? detail.userAccounts : [];
                      const barbersWithoutUser = Array.isArray(detail.barbersWithoutUser)
                        ? detail.barbersWithoutUser
                        : [];
                      const recent = Array.isArray(detail.recentAppointments)
                        ? detail.recentAppointments
                        : [];
                      const contact = detail.settings || {};
                      const barbers = Array.isArray(detail.barbers) ? detail.barbers : [];
                      const draft = newUserByTenant[tenant.id] || {
                        fullName: "",
                        username: "",
                        role: "barber",
                        barberId: "",
                        password: "",
                      };

                      return (
                        <div className="space-y-4">
                          <div className="grid gap-2 text-sm md:grid-cols-3">
                            <div className="rounded-lg bg-zinc-900/70 px-3 py-2">
                              Barberos activos:{" "}
                              <span className="font-semibold text-zinc-100">
                                {counts.barbersActive}/{counts.barbersTotal}
                              </span>
                            </div>
                            <div className="rounded-lg bg-zinc-900/70 px-3 py-2">
                              Servicios activos:{" "}
                              <span className="font-semibold text-zinc-100">
                                {counts.servicesActive}/{counts.servicesTotal}
                              </span>
                            </div>
                            <div className="rounded-lg bg-zinc-900/70 px-3 py-2">
                              Usuarios activos:{" "}
                              <span className="font-semibold text-zinc-100">
                                {counts.usersActive}/{counts.usersTotal}
                              </span>
                            </div>
                          </div>

                          <div className="grid gap-2 text-sm md:grid-cols-3">
                            <div className="rounded-lg bg-zinc-900/70 px-3 py-2">
                              Hoy:{" "}
                              <span className="font-semibold text-zinc-100">
                                {stats.todayTotal}
                              </span>{" "}
                              (P:{stats.todayPending} / C:{stats.todayInProgress} / D:{stats.todayDone})
                            </div>
                            <div className="rounded-lg bg-zinc-900/70 px-3 py-2">
                              Mes actual:{" "}
                              <span className="font-semibold text-zinc-100">{stats.monthTotal}</span>
                            </div>
                            <div className="rounded-lg bg-zinc-900/70 px-3 py-2">
                              Finalizados mes:{" "}
                              <span className="font-semibold text-zinc-100">{stats.monthDone}</span>
                            </div>
                          </div>

                          <div className="rounded-lg bg-zinc-900/70 px-3 py-2 text-sm text-zinc-300">
                            Contacto: {contact.contact_phone || "-"} · WhatsApp:{" "}
                            {contact.contact_whatsapp || "-"} · Instagram:{" "}
                            {contact.contact_instagram || "-"}
                          </div>

                          <div className="rounded-xl bg-zinc-900/60 p-3 ring-1 ring-white/10">
                            <h4 className="mb-2 text-sm font-bold">
                              Barberos sin usuario ({barbersWithoutUser.length})
                            </h4>
                            {barbersWithoutUser.length ? (
                              <div className="grid gap-2 md:grid-cols-2">
                                {barbersWithoutUser.map((b) => (
                                  <div
                                    key={b.id}
                                    className="flex items-center justify-between gap-2 rounded-lg bg-zinc-950/70 px-2 py-1.5 text-xs ring-1 ring-white/10"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate font-semibold text-zinc-200">
                                        {b.full_name}
                                      </div>
                                      <div className="truncate text-zinc-400">
                                        {b.branch_name || "Sucursal"}
                                      </div>
                                    </div>
                                    <button
                                      onClick={() =>
                                        setNewUserByTenant((prev) => ({
                                          ...prev,
                                          [tenant.id]: {
                                            ...draft,
                                            role: "barber",
                                            barberId: String(b.id),
                                            fullName: b.full_name || draft.fullName,
                                            username:
                                              suggestUsernameFromName(b.full_name) ||
                                              draft.username,
                                          },
                                        }))
                                      }
                                      className="shrink-0 rounded bg-amber-400 px-2 py-1 text-[11px] font-semibold text-zinc-950"
                                    >
                                      Crear acceso
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-xs text-zinc-400">
                                Todos los barberos activos ya tienen un usuario asociado.
                              </div>
                            )}
                          </div>

                          <div className="rounded-xl bg-zinc-900/60 p-3 ring-1 ring-white/10">
                            <h4 className="mb-2 text-sm font-bold">Crear usuario</h4>
                            <div className="grid gap-2 md:grid-cols-5">
                              <input
                                placeholder="Nombre completo"
                                value={draft.fullName}
                                onChange={(e) =>
                                  setNewUserByTenant((prev) => ({
                                    ...prev,
                                    [tenant.id]: { ...draft, fullName: e.target.value },
                                  }))
                                }
                                className="rounded bg-zinc-950 px-2 py-1.5 text-xs ring-1 ring-white/10"
                              />
                              <input
                                placeholder="username"
                                value={draft.username}
                                onChange={(e) =>
                                  setNewUserByTenant((prev) => ({
                                    ...prev,
                                    [tenant.id]: { ...draft, username: e.target.value },
                                  }))
                                }
                                className="rounded bg-zinc-950 px-2 py-1.5 text-xs ring-1 ring-white/10"
                              />
                              <select
                                value={draft.role}
                                onChange={(e) =>
                                  setNewUserByTenant((prev) => ({
                                    ...prev,
                                    [tenant.id]: {
                                      ...draft,
                                      role: e.target.value,
                                      barberId: e.target.value === "barber" ? draft.barberId : "",
                                    },
                                  }))
                                }
                                className="rounded bg-zinc-950 px-2 py-1.5 text-xs ring-1 ring-white/10"
                              >
                                <option value="barber">Barber</option>
                                <option value="admin">Admin</option>
                              </select>
                              <select
                                value={draft.barberId}
                                onChange={(e) =>
                                  setNewUserByTenant((prev) => ({
                                    ...prev,
                                    [tenant.id]: { ...draft, barberId: e.target.value },
                                  }))
                                }
                                disabled={draft.role !== "barber"}
                                className="rounded bg-zinc-950 px-2 py-1.5 text-xs ring-1 ring-white/10 disabled:opacity-50"
                              >
                                <option value="">Barbero asociado</option>
                                {barbers
                                  .filter((b) => !!b.is_active)
                                  .map((b) => (
                                    <option key={b.id} value={b.id}>
                                      {b.full_name}
                                    </option>
                                  ))}
                              </select>
                              <input
                                type="password"
                                placeholder="Contraseña"
                                value={draft.password}
                                onChange={(e) =>
                                  setNewUserByTenant((prev) => ({
                                    ...prev,
                                    [tenant.id]: { ...draft, password: e.target.value },
                                  }))
                                }
                                className="rounded bg-zinc-950 px-2 py-1.5 text-xs ring-1 ring-white/10"
                              />
                            </div>
                            <button
                              onClick={() => createTenantUser(tenant)}
                              disabled={creatingUserTenantId === tenant.id}
                              className="mt-2 rounded bg-amber-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 disabled:opacity-50"
                            >
                              {creatingUserTenantId === tenant.id ? "Creando..." : "Crear usuario"}
                            </button>
                          </div>

                          <div className="grid gap-3 lg:grid-cols-2">
                            <div className="rounded-xl bg-zinc-900/60 p-3 ring-1 ring-white/10">
                              <h4 className="mb-2 text-sm font-bold">Usuarios</h4>
                              <div className="max-h-48 overflow-auto">
                                {users.length ? (
                                  <table className="w-full text-xs">
                                    <thead className="text-zinc-400">
                                      <tr>
                                        <th className="pb-1 text-left">Usuario</th>
                                        <th className="pb-1 text-left">Rol</th>
                                        <th className="pb-1 text-left">Estado</th>
                                        <th className="pb-1 text-left">Acciones</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {users.map((u) => (
                                        <tr key={u.id} className="border-t border-white/10">
                                          <td className="py-1 pr-2 text-zinc-200">{u.username}</td>
                                          <td className="py-1 pr-2">{u.role}</td>
                                          <td className="py-1">{u.is_active ? "Activo" : "Inactivo"}</td>
                                          <td className="py-1">
                                            <div className="flex flex-wrap gap-1">
                                              <button
                                                onClick={() =>
                                                  updateUserStatus(tenant.id, u.id, !u.is_active)
                                                }
                                                disabled={savingUserId === u.id}
                                                className="rounded bg-zinc-800 px-2 py-1 text-[11px] font-semibold text-zinc-100 disabled:opacity-50"
                                              >
                                                {savingUserId === u.id
                                                  ? "Guardando..."
                                                  : u.is_active
                                                  ? "Inactivar"
                                                  : "Activar"}
                                              </button>
                                              <button
                                                onClick={() =>
                                                  resetUserPassword(tenant.id, u.id, u.username)
                                                }
                                                disabled={savingUserId === u.id}
                                                className="rounded bg-amber-400 px-2 py-1 text-[11px] font-semibold text-zinc-950 disabled:opacity-50"
                                              >
                                                Reset pass
                                              </button>
                                              {u.role === "barber" && !u.is_active ? (
                                                <button
                                                  onClick={() =>
                                                    deleteBarberUser(tenant.id, u.id, u.username)
                                                  }
                                                  disabled={savingUserId === u.id}
                                                  className="rounded bg-red-600/80 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                                                >
                                                  Eliminar
                                                </button>
                                              ) : null}
                                            </div>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                ) : (
                                  <div className="text-xs text-zinc-400">Sin usuarios.</div>
                                )}
                              </div>
                            </div>

                            <div className="rounded-xl bg-zinc-900/60 p-3 ring-1 ring-white/10">
                              <h4 className="mb-2 text-sm font-bold">Ultimos turnos</h4>
                              <div className="max-h-48 overflow-auto space-y-1 text-xs">
                                {recent.length ? (
                                  recent.map((a) => (
                                    <div
                                      key={a.id}
                                      className="rounded-lg bg-zinc-950/70 px-2 py-1 ring-1 ring-white/10"
                                    >
                                      <div className="font-semibold text-zinc-200">
                                        {a.customer_name} · {a.service_name}
                                      </div>
                                      <div className="text-zinc-400">
                                        {a.barber_name} · {a.start_at} · {a.status}
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="text-xs text-zinc-400">Sin turnos registrados.</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  )}
                </div>
              ) : null}
            </article>
          ))}
        </section>

        <section className="rounded-2xl bg-zinc-900/45 p-4 ring-1 ring-white/10">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-base font-bold">Auditoría de plataforma</h3>
            <button
              onClick={refreshAuditOnly}
              disabled={loadingAudit}
              className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-100 disabled:opacity-50"
            >
              {loadingAudit ? "Actualizando..." : "Actualizar"}
            </button>
          </div>
          <div className="max-h-72 space-y-2 overflow-auto pr-1">
            {auditLogs.length ? (
              auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-lg bg-zinc-950/70 px-3 py-2 text-xs ring-1 ring-white/10"
                >
                  <div className="font-semibold text-zinc-200">
                    {log.action} · {log.actorUsername}
                  </div>
                  <div className="text-zinc-400">
                    {log.createdAt} · tenant {log.tenantId ?? "-"} · user {log.targetUserId ?? "-"}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-xs text-zinc-400">Sin eventos de auditoría.</div>
            )}
          </div>
        </section>
      </Container>
    </div>
  );
}

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

function formatMonthLabel(yyyyMm) {
  const raw = String(yyyyMm || "").trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return raw || "-";
  const [y, m] = raw.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString("es-AR", { month: "short", year: "numeric" });
}

function toCsvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
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

function getOnboardingChecks(onboarding) {
  const tenantName = String(onboarding?.tenantName || "").trim();
  const slug = toSlug(onboarding?.tenantSlug || onboarding?.tenantName);
  const adminName = String(onboarding?.adminName || "").trim();
  const adminUsername = String(onboarding?.adminUsername || "").trim().toLowerCase();
  const adminPassword = String(onboarding?.adminPassword || "");

  const checks = [
    { key: "tenantName", label: "Nombre de barbería", done: tenantName.length >= 3 },
    { key: "tenantSlug", label: "Subdominio", done: slug.length >= 3 && slug.length <= 80 },
    { key: "adminName", label: "Nombre del administrador", done: adminName.length >= 3 },
    {
      key: "adminUsername",
      label: "Usuario administrador",
      done: /^[a-z0-9_.-]{3,60}$/.test(adminUsername),
    },
    {
      key: "adminPassword",
      label: "Clave segura (mínimo 8 caracteres)",
      done: adminPassword.length >= 8,
    },
  ];

  const doneCount = checks.filter((item) => item.done).length;
  const canCreate = doneCount === checks.length;

  let step = 1;
  if (doneCount >= 3) step = 2;
  if (doneCount === checks.length) step = 3;

  return { checks, doneCount, canCreate, step, slug };
}

function tenantStatusLabel(status) {
  switch (String(status || "").toLowerCase()) {
    case "active":
      return "activo";
    case "inactive":
      return "inactivo";
    case "suspended":
      return "suspendido";
    default:
      return String(status || "-");
  }
}

function appointmentStatusLabel(status) {
  switch (String(status || "").toLowerCase()) {
    case "pending":
      return "Pendiente";
    case "in_progress":
      return "En curso";
    case "done":
      return "Finalizado";
    case "no_show":
      return "No asistió";
    case "cancelled":
      return "Cancelado";
    default:
      return String(status || "-");
  }
}

export default function PlatformDashboardPage() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState(null);
  const [billingMetrics, setBillingMetrics] = useState(null);
  const [payingId, setPayingId] = useState(0);
  const [togglingId, setTogglingId] = useState(0);
  const [activatingTrialId, setActivatingTrialId] = useState(0);
  const [deletingTenantId, setDeletingTenantId] = useState(0);
  const [togglingMultiBranchId, setTogglingMultiBranchId] = useState(0);
  const [savingBookingPaymentId, setSavingBookingPaymentId] = useState(0);
  const [removingPaymentId, setRemovingPaymentId] = useState(0);
  const [methodByTenant, setMethodByTenant] = useState({});
  const [trialDaysByTenant, setTrialDaysByTenant] = useState({});
  const [bookingPaymentByTenant, setBookingPaymentByTenant] = useState({});
  const [okMsg, setOkMsg] = useState("");
  const [openTenantId, setOpenTenantId] = useState(0);
  const [loadingOverviewId, setLoadingOverviewId] = useState(0);
  const [overviewByTenant, setOverviewByTenant] = useState({});
  const [savingUserId, setSavingUserId] = useState(0);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [creatingUserTenantId, setCreatingUserTenantId] = useState(0);
  const [newUserByTenant, setNewUserByTenant] = useState({});
  const [userFormErrorByTenant, setUserFormErrorByTenant] = useState({});
  const [tenantFilter, setTenantFilter] = useState("all");
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
  const overdueTenantIds = useMemo(
    () => new Set((billingMetrics?.overdueTenants || []).map((t) => Number(t.id))),
    [billingMetrics]
  );
  const filteredTenants = useMemo(() => {
    const list = tenants || [];
    const now = Date.now();
    const isTrialInWindow = (tenant) => {
      const enabled = !!tenant?.trial?.enabled;
      if (!enabled) return false;
      const endsAtRaw = String(tenant?.trial?.endsAt || "").trim();
      if (!endsAtRaw) return true;
      const d = new Date(endsAtRaw.replace(" ", "T"));
      if (Number.isNaN(d.getTime())) return enabled;
      return d.getTime() >= now;
    };

    switch (tenantFilter) {
      case "active":
        return list.filter((t) => String(t.status || "").toLowerCase() === "active");
      case "trial":
        return list.filter((t) => isTrialInWindow(t));
      case "suspended":
        return list.filter((t) => String(t.status || "").toLowerCase() !== "active");
      case "moroso":
        return list.filter((t) => overdueTenantIds.has(Number(t.id)));
      default:
        return list;
    }
  }, [tenants, tenantFilter, overdueTenantIds]);
  const trendMax = useMemo(() => {
    const vals = (billingMetrics?.trend || []).map((t) => Number(t.expectedArs || 0));
    return vals.length ? Math.max(...vals, 1) : 1;
  }, [billingMetrics]);
  const firstBaseDomain = platformConfig.tenantBaseDomains?.[0] || "localhost";
  const onboardingState = useMemo(
    () => getOnboardingChecks(onboarding),
    [onboarding]
  );

  useEffect(() => {
    if (!session?.token) {
      nav("/platform/login", { replace: true });
      return;
    }
    let alive = true;
    async function bootstrap() {
      try {
        await platformFetch("/platform/auth/me");
        const [data, audit, metrics] = await Promise.all([
          platformFetch("/platform/billing/overview"),
          platformFetch("/platform/audit?limit=50"),
          platformFetch("/platform/billing/metrics?months=6"),
        ]);
        const cfg = await platformFetch("/platform/config");
        if (!alive) return;
        setOverview(data);
        setBillingMetrics(metrics);
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
        setBookingPaymentByTenant(
          Object.fromEntries(
            (data.tenants || []).map((t) => [
              t.id,
              {
                required: t?.bookingPayment?.required === true,
                mpAccessToken: "",
                mpCollectorId: t?.bookingPayment?.collectorId || "",
              },
            ])
          )
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

  function exportBillingCsv() {
    const month = billingMetrics?.month || overview?.month || "";
    const rows = tenants.map((tenant) => {
      const payment = tenant.payment || null;
      return [
        month,
        tenant.id,
        tenant.slug,
        tenant.name,
        tenant.status,
        tenant.currentMonthPaid ? "si" : "no",
        tenant.suspendedByPayment ? "si" : "no",
        payment?.payment_method || "",
        payment?.amount_ars || "",
        payment?.paid_at || "",
      ];
    });

    const headers = [
      "mes",
      "tenant_id",
      "slug",
      "nombre",
      "estado",
      "pagado_mes_actual",
      "suspendido_por_pago",
      "metodo_pago",
      "monto_ars",
      "pagado_en",
    ];

    const csv = [headers, ...rows]
      .map((line) => line.map((cell) => toCsvCell(cell)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `billing-${month || "actual"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    markOk("CSV de cobros exportado");
  }

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [data, audit, metrics] = await Promise.all([
        platformFetch("/platform/billing/overview"),
        platformFetch("/platform/audit?limit=50"),
        platformFetch("/platform/billing/metrics?months=6"),
      ]);
      setOverview(data);
      setBillingMetrics(metrics);
      setAuditLogs(Array.isArray(audit?.logs) ? audit.logs : []);
      setBookingPaymentByTenant((prev) => {
        const next = { ...prev };
        for (const tenant of data?.tenants || []) {
          const current = prev?.[tenant.id] || {};
          next[tenant.id] = {
            required:
              current.required !== undefined
                ? current.required
                : tenant?.bookingPayment?.required === true,
            mpAccessToken: current.mpAccessToken || "",
            mpCollectorId:
              current.mpCollectorId !== undefined && String(current.mpCollectorId) !== ""
                ? current.mpCollectorId
                : tenant?.bookingPayment?.collectorId || "",
          };
        }
        return next;
      });
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

  async function activateTrial(tenant) {
    const trialDaysRaw = Number(trialDaysByTenant[tenant.id]);
    const trialDays = Number.isInteger(trialDaysRaw)
      ? Math.min(Math.max(trialDaysRaw, 1), 30)
      : 30;

    const yes = window.confirm(
      `Se activará una prueba gratuita de ${trialDays} días para ${tenant.name}. ¿Continuar?`
    );
    if (!yes) return;

    setActivatingTrialId(tenant.id);
    setError("");
    try {
      await platformFetch(`/platform/tenants/${tenant.id}/trial`, {
        method: "PATCH",
        body: { enabled: true, days: trialDays },
      });
      markOk(`Prueba gratuita activada por ${trialDays} días para ${tenant.name}`);
      await refresh();
    } catch (e) {
      setError(e.message || "No se pudo activar la prueba gratuita");
    } finally {
      setActivatingTrialId(0);
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

  async function saveBookingPaymentSettings(tenant) {
    const draft = bookingPaymentByTenant[tenant.id] || {};
    const required = draft.required === true;
    const mpAccessToken = String(draft.mpAccessToken || "").trim();
    const mpCollectorId = String(draft.mpCollectorId || "").trim();

    if (required && !mpAccessToken && tenant?.bookingPayment?.required !== true) {
      setError("Para habilitar pago previo debes ingresar el Access Token de Mercado Pago.");
      return;
    }

    setSavingBookingPaymentId(tenant.id);
    setError("");
    try {
      await platformFetch(`/platform/tenants/${tenant.id}/booking-payment`, {
        method: "PATCH",
        body: {
          required,
          mpAccessToken,
          mpCollectorId: mpCollectorId || null,
        },
      });
      markOk(
        required
          ? `Pago previo habilitado para ${tenant.name}`
          : `Pago previo deshabilitado para ${tenant.name}`
      );
      setBookingPaymentByTenant((prev) => ({
        ...prev,
        [tenant.id]: {
          required,
          mpAccessToken: "",
          mpCollectorId,
        },
      }));
      await refresh();
    } catch (e) {
      setError(e.message || "No se pudo actualizar pago previo de reservas");
    } finally {
      setSavingBookingPaymentId(0);
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
      `Nueva contraseña para ${username} (mínimo 8 caracteres):`,
      ""
    );
    if (custom === null) return;
    if (custom.trim().length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setSavingUserId(userId);
    setError("");
    try {
      await platformFetch(`/platform/tenants/${tenantId}/users/${userId}/reset-password`, {
        method: "POST",
        body: { newPassword: custom.trim() },
      });
      markOk(`Contraseña actualizada para ${username}`);
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
    const role = String(draft.role || "barber")
      .trim()
      .toLowerCase();
    const fullName = String(draft.fullName || "").trim();
    const username = String(draft.username || "")
      .trim()
      .toLowerCase();
    const password = String(draft.password || "");
    const barberId =
      role === "barber" && draft.barberId !== null && draft.barberId !== undefined
        ? Number(draft.barberId)
        : null;

    if (!fullName) {
      setUserFormErrorByTenant((prev) => ({
        ...prev,
        [tenant.id]: "Ingresá el nombre completo.",
      }));
      return;
    }
    if (!/^[a-z0-9_.-]{3,60}$/.test(username)) {
      setUserFormErrorByTenant((prev) => ({
        ...prev,
        [tenant.id]: "Usuario inválido (3-60, minúsculas, números y ._-).",
      }));
      return;
    }
    if (password.length < 8) {
      setUserFormErrorByTenant((prev) => ({
        ...prev,
        [tenant.id]: "La contraseña debe tener al menos 8 caracteres.",
      }));
      return;
    }
    if (role === "barber" && (!Number.isInteger(barberId) || barberId <= 0)) {
      setUserFormErrorByTenant((prev) => ({
        ...prev,
        [tenant.id]: "Seleccioná un barbero asociado antes de crear el usuario.",
      }));
      return;
    }

    setCreatingUserTenantId(tenant.id);
    setError("");
    setUserFormErrorByTenant((prev) => ({ ...prev, [tenant.id]: "" }));
    try {
      await platformFetch(`/platform/tenants/${tenant.id}/users`, {
        method: "POST",
        body: {
          fullName,
          username,
          role,
          barberId,
          password,
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
      setUserFormErrorByTenant((prev) => ({ ...prev, [tenant.id]: "" }));
      markOk("Usuario creado correctamente");
      refreshAuditOnly();
    } catch (e) {
      const msg = e.message || "No se pudo crear usuario";
      setUserFormErrorByTenant((prev) => ({ ...prev, [tenant.id]: msg }));
      setError(msg);
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
  const monthlyTotals = billingMetrics?.totals || {};
  const reportMonthLabel = formatMonthLabel(billingMetrics?.month || overview?.month);

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
              onClick={exportBillingCsv}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold ring-1 ring-white/10 hover:bg-zinc-800"
            >
              Exportar CSV
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

          <div className="mb-3 rounded-xl bg-zinc-950/70 p-3 ring-1 ring-white/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-300">
                Asistente de alta
              </div>
              <div className="text-xs text-zinc-400">
                Paso {onboardingState.step} de 3 · {onboardingState.doneCount}/
                {onboardingState.checks.length} completos
              </div>
            </div>
            <div className="mt-2 grid gap-1 md:grid-cols-2">
              {onboardingState.checks.map((item) => (
                <div
                  key={item.key}
                  className={[
                    "rounded-lg px-2 py-1 text-xs",
                    item.done
                      ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30"
                      : "bg-zinc-900 text-zinc-400 ring-1 ring-white/10",
                  ].join(" ")}
                >
                  {item.done ? "Listo" : "Pendiente"} · {item.label}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-4">
            <input
              value={onboarding.tenantName}
              onChange={(e) =>
                setOnboarding((prev) => {
                  const nextName = e.target.value;
                  const next = { ...prev, tenantName: nextName };
                  if (!String(prev.tenantSlug || "").trim()) {
                    next.tenantSlug = toSlug(nextName);
                  }
                  if (!String(prev.adminUsername || "").trim()) {
                    next.adminUsername = suggestUsernameFromName(nextName);
                  }
                  return next;
                })
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
                setOnboarding((prev) => {
                  const nextAdminName = e.target.value;
                  const next = { ...prev, adminName: nextAdminName };
                  if (!String(prev.adminUsername || "").trim()) {
                    next.adminUsername = suggestUsernameFromName(nextAdminName);
                  }
                  return next;
                })
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
              disabled={onboardingLoading || !onboardingState.canCreate}
              className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-60"
            >
              {onboardingLoading ? "Creando..." : "Crear barbería y acceso admin"}
            </button>
          </div>
          <div className="mt-2 text-xs text-zinc-400">
            URL estimada:{" "}
            <span className="font-semibold text-zinc-200">
              https://{onboardingState.slug || "<slug>"}.
              {platformConfig.tenantBaseDomains?.[0] || "localhost"}
            </span>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl bg-zinc-900/60 p-4 ring-1 ring-white/10 sm:col-span-2 lg:col-span-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-bold">Reporte mensual SaaS</div>
              <div className="text-xs text-zinc-400">Mes {reportMonthLabel}</div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-zinc-950/70 p-3 ring-1 ring-white/10">
                <div className="text-xs text-zinc-400">MRR cobrado</div>
                <div className="mt-1 text-xl font-black text-emerald-300">
                  {formatMoney(monthlyTotals.mrrCollectedArs)}
                </div>
              </div>
              <div className="rounded-xl bg-zinc-950/70 p-3 ring-1 ring-white/10">
                <div className="text-xs text-zinc-400">MRR pendiente</div>
                <div className="mt-1 text-xl font-black text-amber-300">
                  {formatMoney(monthlyTotals.mrrPendingArs)}
                </div>
              </div>
              <div className="rounded-xl bg-zinc-950/70 p-3 ring-1 ring-white/10">
                <div className="text-xs text-zinc-400">Pruebas activas</div>
                <div className="mt-1 text-xl font-black text-cyan-300">
                  {Number(monthlyTotals.trialActiveCount || 0)}
                </div>
              </div>
              <div className="rounded-xl bg-zinc-950/70 p-3 ring-1 ring-white/10">
                <div className="text-xs text-zinc-400">Suspendidos</div>
                <div className="mt-1 text-xl font-black text-red-300">
                  {Number(monthlyTotals.suspendedTotalCount || 0)}
                </div>
              </div>
            </div>
          </div>

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

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl bg-zinc-900/60 p-4 ring-1 ring-white/10">
            <div className="text-xs text-zinc-400">MRR estimado</div>
            <div className="mt-1 text-2xl font-black">
              {formatMoney(billingMetrics?.totals?.mrrArs)}
            </div>
          </div>
          <div className="rounded-2xl bg-zinc-900/60 p-4 ring-1 ring-white/10">
            <div className="text-xs text-zinc-400">Tasa de cobranza</div>
            <div className="mt-1 text-2xl font-black text-emerald-300">
              {Number(billingMetrics?.totals?.collectionRatePct || 0)}%
            </div>
          </div>
          <div className="rounded-2xl bg-zinc-900/60 p-4 ring-1 ring-white/10">
            <div className="text-xs text-zinc-400">Morosos (vencidos)</div>
            <div className="mt-1 text-2xl font-black text-amber-300">
              {Number(billingMetrics?.totals?.overdueCount || 0)}
            </div>
          </div>
          <div className="rounded-2xl bg-zinc-900/60 p-4 ring-1 ring-white/10">
            <div className="text-xs text-zinc-400">Mes analizado</div>
            <div className="mt-1 text-2xl font-black text-zinc-200">
              {formatMonthLabel(billingMetrics?.month)}
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

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-white/10">
            <h3 className="mb-3 text-base font-bold">Ingresos por método</h3>
            <div className="space-y-3">
              {(billingMetrics?.methods || []).map((row) => (
                <div key={row.method} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300">{row.method}</span>
                    <span className="text-zinc-400">
                      {formatMoney(row.amountArs)} · {Number(row.sharePct || 0)}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-800">
                    <div
                      className="h-2 rounded-full bg-amber-400"
                      style={{ width: `${Math.max(4, Number(row.sharePct || 0))}%` }}
                    />
                  </div>
                </div>
              ))}
              {!(billingMetrics?.methods || []).length ? (
                <div className="text-xs text-zinc-400">Sin datos de pagos por método.</div>
              ) : null}
            </div>
          </article>

          <article className="rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-white/10">
            <h3 className="mb-3 text-base font-bold">Tendencia de cobranza</h3>
            <div className="space-y-3">
              {(billingMetrics?.trend || []).map((row) => (
                <div key={row.month} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300">{formatMonthLabel(row.month)}</span>
                    <span className="text-zinc-400">
                      {formatMoney(row.collectedArs)} / {formatMoney(row.expectedArs)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-800">
                    <div
                      className="h-2 rounded-full bg-emerald-400"
                      style={{
                        width: `${Math.max(
                          4,
                          Math.round((Number(row.collectedArs || 0) / Number(trendMax || 1)) * 100)
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
              {!(billingMetrics?.trend || []).length ? (
                <div className="text-xs text-zinc-400">Sin datos de tendencia.</div>
              ) : null}
            </div>
          </article>
        </section>

        <section className="rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-white/10">
          <h3 className="mb-3 text-base font-bold">Tenants vencidos (prioridad de cobro)</h3>
          <div className="space-y-2">
            {(billingMetrics?.overdueTenants || []).length ? (
              billingMetrics.overdueTenants.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-col gap-2 rounded-xl bg-zinc-950/70 px-3 py-2 text-sm ring-1 ring-white/10 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <div className="font-semibold text-zinc-100">{t.name}</div>
                    <div className="text-xs text-zinc-400">
                      {t.slug} · {t.daysLate} día(s) de atraso · estado {tenantStatusLabel(t.status)}
                    </div>
                  </div>
                  <a
                    href={buildTenantPublicUrl(t.slug, firstBaseDomain)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-100"
                  >
                    Abrir sitio
                  </a>
                </div>
              ))
            ) : (
              <div className="text-sm text-zinc-400">No hay vencidos para este mes.</div>
            )}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-white/10">
            <h3 className="mb-3 text-base font-bold">Vencen hoy</h3>
            {(billingMetrics?.dueTodayTenants || []).length ? (
              <div className="space-y-2">
                {billingMetrics.dueTodayTenants.map((t) => (
                  <div
                    key={`today-${t.id}`}
                    className="rounded-xl bg-zinc-950/70 px-3 py-2 text-sm ring-1 ring-white/10"
                  >
                    <div className="font-semibold text-zinc-100">{t.name}</div>
                    <div className="text-xs text-zinc-400">{t.slug} · mes {t.billingMonth}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-zinc-400">Sin vencimientos para hoy.</div>
            )}
          </article>

          <article className="rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-white/10">
            <h3 className="mb-3 text-base font-bold">Vencen mañana</h3>
            {(billingMetrics?.dueTomorrowTenants || []).length ? (
              <div className="space-y-2">
                {billingMetrics.dueTomorrowTenants.map((t) => (
                  <div
                    key={`tomorrow-${t.id}`}
                    className="rounded-xl bg-zinc-950/70 px-3 py-2 text-sm ring-1 ring-white/10"
                  >
                    <div className="font-semibold text-zinc-100">{t.name}</div>
                    <div className="text-xs text-zinc-400">{t.slug} · mes {t.billingMonth}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-zinc-400">Sin vencimientos para mañana.</div>
            )}
          </article>
        </section>

        <section className="rounded-2xl bg-zinc-900/45 p-4 ring-1 ring-white/10">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-sm font-bold">Tenants</div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setTenantFilter("all")}
                className={[
                  "rounded-lg px-3 py-1.5 text-xs font-semibold",
                  tenantFilter === "all"
                    ? "bg-amber-400 text-zinc-950"
                    : "bg-zinc-800 text-zinc-100",
                ].join(" ")}
              >
                Todos
              </button>
              <button
                onClick={() => setTenantFilter("active")}
                className={[
                  "rounded-lg px-3 py-1.5 text-xs font-semibold",
                  tenantFilter === "active"
                    ? "bg-amber-400 text-zinc-950"
                    : "bg-zinc-800 text-zinc-100",
                ].join(" ")}
              >
                Activos
              </button>
              <button
                onClick={() => setTenantFilter("trial")}
                className={[
                  "rounded-lg px-3 py-1.5 text-xs font-semibold",
                  tenantFilter === "trial"
                    ? "bg-amber-400 text-zinc-950"
                    : "bg-zinc-800 text-zinc-100",
                ].join(" ")}
              >
                Prueba
              </button>
              <button
                onClick={() => setTenantFilter("suspended")}
                className={[
                  "rounded-lg px-3 py-1.5 text-xs font-semibold",
                  tenantFilter === "suspended"
                    ? "bg-amber-400 text-zinc-950"
                    : "bg-zinc-800 text-zinc-100",
                ].join(" ")}
              >
                Suspendidos
              </button>
              <button
                onClick={() => setTenantFilter("moroso")}
                className={[
                  "rounded-lg px-3 py-1.5 text-xs font-semibold",
                  tenantFilter === "moroso"
                    ? "bg-amber-400 text-zinc-950"
                    : "bg-zinc-800 text-zinc-100",
                ].join(" ")}
              >
                Morosos
              </button>
            </div>
          </div>
          <div className="mt-2 text-xs text-zinc-400">
            Mostrando {filteredTenants.length} de {tenants.length} tenants.
          </div>
        </section>

        <section className="space-y-3">
          {filteredTenants.map((tenant) => (
            <article key={tenant.id} className="rounded-2xl bg-zinc-900/45 p-4 ring-1 ring-white/10">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-lg font-bold">{tenant.name}</div>
                  <div className="text-sm text-zinc-400">
                    #{tenant.id} · {tenant.slug} · estado {tenantStatusLabel(tenant.status)}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    Mes: {tenant.billingMonth} · multi-sucursal:{" "}
                    {tenant.multiBranchEnabled ? "habilitado" : "deshabilitado"}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    Pago previo turnos:{" "}
                    {tenant?.bookingPayment?.required ? "habilitado" : "deshabilitado"}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    Prueba:{" "}
                    {tenant?.trial?.enabled
                      ? `activa hasta ${tenant?.trial?.endsAt || "-"}`
                      : "no activa"}
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

              <div className="mt-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
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
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-3 py-2 text-xs text-zinc-200 ring-1 ring-white/10">
                    <input
                      type="checkbox"
                      checked={bookingPaymentByTenant[tenant.id]?.required === true}
                      onChange={(e) =>
                        setBookingPaymentByTenant((prev) => ({
                          ...prev,
                          [tenant.id]: {
                            ...(prev[tenant.id] || {}),
                            required: e.target.checked,
                          },
                        }))
                      }
                    />
                    Requerir pago previo en reservas
                  </label>

                  <input
                    type="text"
                    value={bookingPaymentByTenant[tenant.id]?.mpAccessToken || ""}
                    onChange={(e) =>
                      setBookingPaymentByTenant((prev) => ({
                        ...prev,
                        [tenant.id]: {
                          ...(prev[tenant.id] || {}),
                          mpAccessToken: e.target.value,
                        },
                      }))
                    }
                    placeholder={
                      tenant?.bookingPayment?.required
                        ? "Dejar vacío para mantener token actual"
                        : "MP Access Token (si habilitas pago previo)"
                    }
                    className="w-full min-w-0 flex-1 rounded-xl bg-zinc-950 px-3 py-2 text-xs ring-1 ring-white/10 md:min-w-[260px]"
                  />

                  <button
                    onClick={() => saveBookingPaymentSettings(tenant)}
                    disabled={savingBookingPaymentId === tenant.id}
                    className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:opacity-60"
                  >
                    {savingBookingPaymentId === tenant.id
                      ? "Guardando..."
                      : "Guardar pago previo"}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
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

                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={trialDaysByTenant[tenant.id] ?? 30}
                    onChange={(e) =>
                      setTrialDaysByTenant((prev) => ({
                        ...prev,
                        [tenant.id]: e.target.value,
                      }))
                    }
                    className="w-24 rounded-xl bg-zinc-950 px-3 py-2 text-sm ring-1 ring-white/10"
                    title="Días de prueba (1 a 30)"
                  />

                  <button
                    onClick={() => activateTrial(tenant)}
                    disabled={activatingTrialId === tenant.id}
                    className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:opacity-60"
                  >
                    {activatingTrialId === tenant.id
                      ? "Activando..."
                      : tenant?.trial?.enabled
                      ? "Reiniciar prueba 30 días"
                      : "Activar prueba 30 días"}
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
                      const activeBarbers = barbers.filter((b) => !!b.is_active);
                      const draft = newUserByTenant[tenant.id] || {
                        fullName: "",
                        username: "",
                        role: "barber",
                        barberId: "",
                        password: "",
                      };
                      const userFormError = String(userFormErrorByTenant[tenant.id] || "");

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
                              (Pendientes: {stats.todayPending} / En curso: {stats.todayInProgress} / Finalizados: {stats.todayDone})
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
                                {activeBarbers.map((b) => (
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
                              disabled={
                                creatingUserTenantId === tenant.id ||
                                (draft.role === "barber" && activeBarbers.length === 0)
                              }
                              className="mt-2 rounded bg-amber-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 disabled:opacity-50"
                            >
                              {creatingUserTenantId === tenant.id ? "Creando..." : "Crear usuario"}
                            </button>
                            {draft.role === "barber" && activeBarbers.length === 0 ? (
                              <div className="mt-2 text-xs text-amber-300">
                                No hay barberos activos para asociar. Creá o activá un barbero primero
                                desde el panel administrador de la barbería.
                              </div>
                            ) : null}
                            {userFormError ? (
                              <div className="mt-2 text-xs text-red-300">{userFormError}</div>
                            ) : null}
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
                                                Restablecer clave
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
                                        {a.barber_name} · {a.start_at} · {appointmentStatusLabel(a.status)}
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

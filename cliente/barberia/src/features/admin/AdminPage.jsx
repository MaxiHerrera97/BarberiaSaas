
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../auth/auth-context";

import Container from "../../components/Container";
import Button from "../../ui/Button";

import {
  buildDaySlots,
  formatTime,
  msToMMSS,
  parseMySQLDateTimeLocal,
} from "./admin.utils";

function statusBadge(status) {
  const base = "text-xs font-semibold px-2 py-1 rounded-lg ring-1";
  switch (status) {
    case "in_progress":
      return `${base} bg-amber-400 text-zinc-950 ring-amber-300`;
    case "done":
      return `${base} bg-emerald-400 text-zinc-950 ring-emerald-300`;
    case "no_show":
      return `${base} bg-red-400 text-zinc-950 ring-red-300`;
    case "cancelled":
      return `${base} bg-zinc-700 text-zinc-100 ring-white/10`;
    default:
      return `${base} bg-zinc-800 text-zinc-100 ring-white/10`;
  }
}

function toDateParam(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatArs(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function parseDateParam(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date();
  const d = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

function mapApiAppointment(r) {
  const start = parseMySQLDateTimeLocal(r.start_at);
  const end = parseMySQLDateTimeLocal(r.end_at);

  return {
    id: String(r.id),
    barberId: r.barber_id,
    serviceId: r.service_id,
    serviceNameSnapshot: String(r.service_name_snapshot || "").trim(),
    servicePriceSnapshot: Number(r.service_price_ars_snapshot || 0) || null,
    serviceDurationSnapshot: Number(r.service_duration_min_snapshot || 0) || null,
    customerName: r.customer_name,
    customerPhone: r.customer_phone || "",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    status: r.status,
    notes: r.notes || "",
  };
}

export default function AdminPage({
  barbers = [],
  branches = [],
  services = [],
  loadingCatalog = false,
  catalogError = "",
}) {
  const { session, clearAuth } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  const [date, setDate] = useState(() => new Date());

  const [appointments, setAppointments] = useState([]);
  const [barberDayWindows, setBarberDayWindows] = useState({});
  const [barberWindowsLoading, setBarberWindowsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [savingId, setSavingId] = useState(null);
  const [walkInServiceByBarber, setWalkInServiceByBarber] = useState({});
  const [walkInSavingBarberId, setWalkInSavingBarberId] = useState(0);
  const activeBranches = useMemo(
    () => (Array.isArray(branches) ? branches.filter((b) => !!b.isActive) : []),
    [branches]
  );
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [billingInfo, setBillingInfo] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [cashSummary, setCashSummary] = useState(null);
  const [cashLoading, setCashLoading] = useState(false);
  const [cashError, setCashError] = useState("");
  const [cashClosing, setCashClosing] = useState(false);
  const [cashReopening, setCashReopening] = useState(false);
  const [cashMsg, setCashMsg] = useState("");
  const [commissionSummary, setCommissionSummary] = useState(null);
  const [commissionLoading, setCommissionLoading] = useState(false);
  const [commissionError, setCommissionError] = useState("");
  const [commissionSavingBarberId, setCommissionSavingBarberId] = useState(0);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const serviceById = useMemo(() => {
    const m = new Map();
    services.forEach((s) => m.set(s.id, s));
    return m;
  }, [services]);
  const billableServices = useMemo(
    () =>
      services.filter(
        (s) => Number(s?.quoteOnly || 0) !== 1 && Number(s?.price || 0) > 0 && Number(s?.durationMin || 0) > 0
      ),
    [services]
  );

  const billingView = useMemo(() => {
    const billing = billingInfo?.billing || {};
    const trial = billingInfo?.trial || {};
    const trialEndsLabel = trial?.endsAt
      ? new Date(String(trial.endsAt).replace(" ", "T")).toLocaleDateString("es-AR")
      : "-";
    const inTrial = !!trial?.inWindow;
    const paid = !!billing?.currentMonthPaid;
    const isPastDue = !!billing?.isPastDue;
    const isPaymentWindow = !!billing?.isPaymentWindow;

    let title = "Mes pendiente";
    if (inTrial) {
      title = "Período de prueba activo";
    } else if (paid) {
      title = "Mes pagado";
    } else if (!isPaymentWindow && !isPastDue) {
      title = "Próximo cobro mensual";
    }

    let subtitle = `Mes ${billing?.billingMonth || "-"} · vence día ${
      billing?.dueDay || 5
    } · ARS ${billing?.monthlyFeeArs || 30000}`;
    if (inTrial) {
      subtitle = `Prueba gratis activa hasta ${trialEndsLabel} · luego continúa el cobro mensual.`;
    }

    return { title, subtitle, inTrial };
  }, [billingInfo]);

  const billingBanner = useMemo(() => {
    const billing = billingInfo?.billing || {};
    const trial = billingInfo?.trial || {};
    const payment = billingInfo?.payment || null;
    const dueDay = Number(billing?.dueDay || 5);
    const today = now.getDate();

    if (trial?.inWindow) {
      const endsLabel = trial?.endsAt
        ? new Date(String(trial.endsAt).replace(" ", "T")).toLocaleDateString("es-AR")
        : "-";
      return {
        tone: "info",
        title: "Período de prueba activo",
        text: `Podés usar todas las funciones hasta el ${endsLabel}. Te recomendamos activar el débito automático para continuar sin cortes.`,
      };
    }

    if (billing?.currentMonthPaid) {
      if (payment?.paid_at) {
        const paidAt = new Date(String(payment.paid_at).replace(" ", "T"));
        if (!Number.isNaN(paidAt.getTime())) {
          const hoursSincePaid = (Date.now() - paidAt.getTime()) / (1000 * 60 * 60);
          if (hoursSincePaid >= 0 && hoursSincePaid <= 48) {
            return {
              tone: "success",
              title: "Pago acreditado",
              text: "Tu servicio está activo y al día. Gracias por mantener tu cuenta al corriente.",
            };
          }
        }
      }
      return null;
    }

    if (billing?.isPaymentWindow) {
      if (today === dueDay) {
        return {
          tone: "warning",
          title: "Hoy vence tu pago mensual",
          text: "Si no abonás hoy, tu servicio puede suspenderse. Realizá el pago para evitar interrupciones.",
        };
      }

      return {
        tone: "warning",
        title: "Mes pendiente de pago",
        text: `Recordatorio: podés abonar del día 1 al ${dueDay} para mantener el servicio activo.`,
      };
    }

    if (!billing?.isPaymentWindow && !billing?.isPastDue) {
      return {
        tone: "info",
        title: "Próximo cobro mensual",
        text: "Tu próximo período de pago todavía no abrió. Te avisaremos cuando esté habilitado.",
      };
    }

    return null;
  }, [billingInfo, now]);
  const manualOnlySubscription = !!billingInfo?.subscription?.manualOnly;
  const effectiveOnlinePaymentMode = manualOnlySubscription
    ? "checkout"
    : billingInfo?.onlinePayment?.mode;
  const dayCashSource = cashSummary?.closing?.isClosed
    ? cashSummary?.closing?.snapshot?.daily || cashSummary?.daily || {}
    : cashSummary?.daily || {};
  const dayByBarberSource = cashSummary?.closing?.isClosed
    ? cashSummary?.closing?.snapshot?.byBarber || cashSummary?.byBarberDay || []
    : cashSummary?.byBarberDay || [];
  const dayByServiceSource = cashSummary?.closing?.isClosed
    ? cashSummary?.closing?.snapshot?.byService || cashSummary?.byServiceDay || []
    : cashSummary?.byServiceDay || [];
  const canCloseCashDay = Number(dayCashSource?.services_done || 0) > 0;

  useEffect(() => {
    if (session?.role !== "admin") return;
    if (activeBranches.length <= 1) {
      setSelectedBranchId("");
      return;
    }
    if (selectedBranchId === "all") return;
    if (
      !selectedBranchId ||
      !activeBranches.some((b) => String(b.id) === String(selectedBranchId))
    ) {
      setSelectedBranchId("all");
    }
  }, [session?.role, activeBranches, selectedBranchId]);

  const visibleBarbers = useMemo(() => {
    if (session?.role !== "admin") {
      return barbers.filter((b) => b.id === session?.barberId);
    }
    if (!selectedBranchId || selectedBranchId === "all") return barbers;
    return barbers.filter((b) => String(b.branchId) === String(selectedBranchId));
  }, [session?.role, session?.barberId, barbers, selectedBranchId]);
  const visibleBarberIdsKey = useMemo(
    () => visibleBarbers.map((b) => Number(b.id)).sort((a, b) => a - b).join(","),
    [visibleBarbers]
  );

  const apptsByBarber = useMemo(() => {
    const m = new Map();
    for (const b of visibleBarbers) m.set(b.id, []);

    for (const a of appointments) {
      if (m.has(a.barberId)) m.get(a.barberId).push(a);
    }

    for (const [k, arr] of m.entries()) {
      arr.sort((x, y) => new Date(x.startAt) - new Date(y.startAt));
      m.set(k, arr);
    }
    return m;
  }, [appointments, visibleBarbers]);

  const slotsByBarber = useMemo(() => {
    const m = new Map();
    for (const b of visibleBarbers) {
      const windows = barberDayWindows[b.id] || null;
      m.set(b.id, buildDaySlots(date, 30, windows));
    }
    return m;
  }, [visibleBarbers, barberDayWindows, date]);

  async function loadAppointments() {
    setLoading(true);
    setErr("");

    try {
      const dateStr = toDateParam(date);
      const branchQuery =
        session?.role === "admin" && selectedBranchId && selectedBranchId !== "all"
          ? `&branchId=${selectedBranchId}`
          : "";
      const rows = await apiFetch(`/appointments?date=${dateStr}${branchQuery}`);

      setAppointments(rows.map(mapApiAppointment));
    } catch (e) {
      const msg = e.message || "Error cargando turnos";
      setErr(msg);

      if (
        msg.toLowerCase().includes("token") ||
        msg.toLowerCase().includes("no token") ||
        msg.toLowerCase().includes("invalid token") ||
        msg.toLowerCase().includes("unauthorized")
      ) {
        clearAuth();
        window.location.href = "/login";
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAppointments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId, date]);

  useEffect(() => {
    let alive = true;

    async function loadDayWindowsByBarber() {
      if (!visibleBarbers.length) {
        if (alive) setBarberDayWindows({});
        return;
      }

      setBarberWindowsLoading(true);
      const dateStr = toDateParam(date);
      const branchQuery =
        session?.role === "admin" && selectedBranchId && selectedBranchId !== "all"
          ? `&branchId=${selectedBranchId}`
          : "";

      try {
        const entries = await Promise.all(
          visibleBarbers.map(async (b) => {
            const data = await apiFetch(
              `/appointments/availability?date=${dateStr}&barberId=${b.id}${branchQuery}`
            );
            return [b.id, Array.isArray(data?.dayWindows) ? data.dayWindows : []];
          })
        );

        if (!alive) return;
        setBarberDayWindows((prev) => {
          const next = { ...prev };
          for (const [barberId, windows] of entries) {
            next[barberId] = Array.isArray(windows) ? windows : [];
          }
          return next;
        });
      } catch {
        // Mantener último estado válido para evitar "saltos" de grilla.
      } finally {
        if (alive) setBarberWindowsLoading(false);
      }
    }

    loadDayWindowsByBarber();
    return () => {
      alive = false;
    };
  }, [visibleBarbers, visibleBarberIdsKey, date, selectedBranchId, session?.role]);

  useEffect(() => {
    let alive = true;
    async function loadBilling() {
      setBillingLoading(true);
      setBillingError("");
      try {
        const data = await apiFetch("/billing/public/status");
        if (!alive) return;
        setBillingInfo(data || null);
      } catch (e) {
        if (!alive) return;
        setBillingError(e.message || "No se pudo cargar estado de facturación");
      } finally {
        if (alive) setBillingLoading(false);
      }
    }

    loadBilling();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadCashSummary() {
      setCashLoading(true);
      setCashError("");
      try {
        const yyyy = date.getFullYear();
        const mm = date.getMonth() + 1;
        const branchQuery =
          session?.role === "admin" && selectedBranchId && selectedBranchId !== "all"
            ? `&branchId=${selectedBranchId}`
            : "";
        const data = await apiFetch(
          `/appointments/cash-summary?date=${toDateParam(date)}&year=${yyyy}&month=${mm}${branchQuery}`
        );
        if (!alive) return;
        setCashSummary(data || null);
      } catch (e) {
        if (!alive) return;
        setCashError(e.message || "No se pudo cargar caja");
      } finally {
        if (alive) setCashLoading(false);
      }
    }

    loadCashSummary();
    return () => {
      alive = false;
    };
  }, [date, selectedBranchId, session?.role]);

  useEffect(() => {
    if (session?.role !== "admin") return;
    let alive = true;
    async function loadCommissions() {
      setCommissionLoading(true);
      setCommissionError("");
      try {
        const yyyy = date.getFullYear();
        const mm = date.getMonth() + 1;
        const branchQuery =
          selectedBranchId && selectedBranchId !== "all"
            ? `&branchId=${selectedBranchId}`
            : "";
        const data = await apiFetch(
          `/appointments/commissions-summary?year=${yyyy}&month=${mm}${branchQuery}`
        );
        if (!alive) return;
        setCommissionSummary(data || null);
      } catch (e) {
        if (!alive) return;
        setCommissionError(e.message || "No se pudo cargar comisiones");
      } finally {
        if (alive) setCommissionLoading(false);
      }
    }
    loadCommissions();
    return () => {
      alive = false;
    };
  }, [date, selectedBranchId, session?.role]);

  async function startMonthlyPayment() {
    if (startingCheckout) return;
    setStartingCheckout(true);
    setBillingError("");
    try {
      const data = await apiFetch("/billing/public/mercadopago/start", {
        method: "POST",
        body: {
          billingMonth: billingInfo?.billing?.billingMonth,
        },
      });
      if (data?.alreadyPaid) {
        const refreshed = await apiFetch("/billing/public/status");
        setBillingInfo(refreshed || null);
        return;
      }
      if (!data?.checkoutUrl) {
        throw new Error("No se pudo generar el link de pago");
      }
      window.location.href = data.checkoutUrl;
    } catch (e) {
      setBillingError(e.message || "No se pudo iniciar el pago online");
    } finally {
      setStartingCheckout(false);
    }
  }

  async function closeCashDay(force = false) {
    if (cashClosing) return;
    setCashClosing(true);
    setCashError("");
    setCashMsg("");
    try {
      const branchIdValue =
        session?.role === "admin" && selectedBranchId && selectedBranchId !== "all"
          ? Number(selectedBranchId)
          : null;
      await apiFetch("/appointments/cash-close-day", {
        method: "POST",
        body: {
          date: toDateParam(date),
          ...(branchIdValue ? { branchId: branchIdValue } : {}),
          ...(force ? { force: true } : {}),
        },
      });

      const yyyy = date.getFullYear();
      const mm = date.getMonth() + 1;
      const branchQuery =
        session?.role === "admin" && selectedBranchId && selectedBranchId !== "all"
          ? `&branchId=${selectedBranchId}`
          : "";
      const refreshed = await apiFetch(
        `/appointments/cash-summary?date=${toDateParam(date)}&year=${yyyy}&month=${mm}${branchQuery}`
      );
      setCashSummary(refreshed || null);
      setCashMsg("Caja diaria cerrada correctamente.");
    } catch (e) {
      if (e?.code === "CASH_ALREADY_CLOSED") {
        const overwrite = window.confirm(
          "La caja de ese día ya estaba cerrada. ¿Querés recalcular y reemplazar el cierre?"
        );
        if (overwrite) {
          setCashClosing(false);
          return closeCashDay(true);
        }
      }
      if (e?.code === "CASH_EMPTY_DAY") {
        setCashError("No hay movimientos finalizados para cerrar la caja de este día.");
      } else {
        setCashError(e.message || "No se pudo cerrar caja del día");
      }
    } finally {
      setCashClosing(false);
    }
  }

  async function reopenCashDay() {
    if (cashReopening) return;
    const reason = window.prompt("Motivo de reapertura de caja (mínimo 5 caracteres):", "");
    if (reason === null) return;
    if (String(reason || "").trim().length < 5) {
      setCashError("Debes indicar un motivo de al menos 5 caracteres para reabrir la caja.");
      return;
    }

    setCashReopening(true);
    setCashError("");
    setCashMsg("");
    try {
      const branchIdValue =
        session?.role === "admin" && selectedBranchId && selectedBranchId !== "all"
          ? Number(selectedBranchId)
          : null;

      await apiFetch("/appointments/cash-reopen-day", {
        method: "POST",
        body: {
          date: toDateParam(date),
          reason: String(reason || "").trim(),
          ...(branchIdValue ? { branchId: branchIdValue } : {}),
        },
      });

      const yyyy = date.getFullYear();
      const mm = date.getMonth() + 1;
      const branchQuery =
        session?.role === "admin" && selectedBranchId && selectedBranchId !== "all"
          ? `&branchId=${selectedBranchId}`
          : "";
      const refreshed = await apiFetch(
        `/appointments/cash-summary?date=${toDateParam(date)}&year=${yyyy}&month=${mm}${branchQuery}`
      );
      setCashSummary(refreshed || null);
      setCashMsg("Caja reabierta correctamente.");
    } catch (e) {
      setCashError(e.message || "No se pudo reabrir caja del día");
    } finally {
      setCashReopening(false);
    }
  }

  function exportCashCsv(scope = "daily") {
    const isMonthly = scope === "monthly";
    const monthLabel = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const dayLabel = toDateParam(date);
    const branchLabel =
      selectedBranchId && selectedBranchId !== "all"
        ? activeBranches.find((b) => String(b.id) === String(selectedBranchId))?.name ||
          `Sucursal ${selectedBranchId}`
        : "Todas las sucursales";

    const totals = isMonthly ? cashSummary?.monthly || {} : dayCashSource || {};
    const byBarber = isMonthly ? cashSummary?.byBarberMonth || [] : dayByBarberSource || [];
    const byService = isMonthly ? cashSummary?.byServiceMonth || [] : dayByServiceSource || [];

    if (!byBarber.length && !byService.length && Number(totals?.services_done || 0) <= 0) {
      setCashError("No hay datos de caja para exportar.");
      return;
    }

    const esc = (value) => {
      const str = String(value ?? "");
      if (str.includes('"') || str.includes(";") || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const lines = [
      ["Reporte", isMonthly ? "Caja mensual" : "Caja diaria"],
      ["Mes", monthLabel],
      ["Fecha", dayLabel],
      ["Sucursal", branchLabel],
      [],
      ["Totales", "", ""],
      ["Servicios", Number(totals?.services_done || 0), ""],
      ["Facturacion_ARS", Number(totals?.revenue_ars || 0), ""],
      ["Comision_ARS", Number(totals?.commission_ars || 0), ""],
      [],
      ["Por barbero", "", "", ""],
      ["Barbero", "Servicios", "Facturacion_ARS", "Comision_ARS"],
      ...byBarber.map((r) => [
        r.barber_name,
        Number(r.services_done || 0),
        Number(r.revenue_ars || 0),
        Number(r.commission_ars || 0),
      ]),
      [],
      ["Por servicio", "", ""],
      ["Servicio", "Servicios", "Facturacion_ARS"],
      ...byService.map((r) => [
        r.service_name,
        Number(r.services_done || 0),
        Number(r.revenue_ars || 0),
      ]),
    ];

    const csv = lines.map((line) => line.map(esc).join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `caja-${isMonthly ? monthLabel : dayLabel}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function settleCommission(barberId) {
    if (commissionSavingBarberId) return;
    setCommissionSavingBarberId(barberId);
    setCommissionError("");
    try {
      const yyyy = date.getFullYear();
      const mm = date.getMonth() + 1;
      const payload = {
        year: yyyy,
        month: mm,
        ...(selectedBranchId && selectedBranchId !== "all"
          ? { branchId: Number(selectedBranchId) }
          : {}),
      };
      await apiFetch(`/appointments/commissions/${barberId}/settle`, {
        method: "POST",
        body: payload,
      });

      const branchQuery =
        selectedBranchId && selectedBranchId !== "all"
          ? `&branchId=${selectedBranchId}`
          : "";
      const refreshed = await apiFetch(
        `/appointments/commissions-summary?year=${yyyy}&month=${mm}${branchQuery}`
      );
      setCommissionSummary(refreshed || null);
    } catch (e) {
      setCommissionError(e.message || "No se pudo liquidar la comisión");
    } finally {
      setCommissionSavingBarberId(0);
    }
  }

  async function reopenCommission(barberId) {
    if (commissionSavingBarberId) return;
    setCommissionSavingBarberId(barberId);
    setCommissionError("");
    try {
      const yyyy = date.getFullYear();
      const mm = date.getMonth() + 1;
      const payload = {
        year: yyyy,
        month: mm,
        ...(selectedBranchId && selectedBranchId !== "all"
          ? { branchId: Number(selectedBranchId) }
          : {}),
      };
      await apiFetch(`/appointments/commissions/${barberId}/reopen`, {
        method: "POST",
        body: payload,
      });

      const branchQuery =
        selectedBranchId && selectedBranchId !== "all"
          ? `&branchId=${selectedBranchId}`
          : "";
      const refreshed = await apiFetch(
        `/appointments/commissions-summary?year=${yyyy}&month=${mm}${branchQuery}`
      );
      setCommissionSummary(refreshed || null);
    } catch (e) {
      setCommissionError(e.message || "No se pudo reabrir la comisión");
    } finally {
      setCommissionSavingBarberId(0);
    }
  }

  function exportCommissionsCsv() {
    const items = commissionSummary?.items || [];
    if (!items.length) {
      setCommissionError("No hay datos de comisiones para exportar.");
      return;
    }

    const monthLabel =
      commissionSummary?.month ||
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const branchLabel =
      selectedBranchId && selectedBranchId !== "all"
        ? activeBranches.find((b) => String(b.id) === String(selectedBranchId))?.name ||
          `Sucursal ${selectedBranchId}`
        : "Todas las sucursales";

    const escapeCsv = (value) => {
      const str = String(value ?? "");
      if (str.includes('"') || str.includes(";") || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = [
      ["Mes", monthLabel],
      ["Sucursal", branchLabel],
      [],
      ["Barbero", "Servicios", "Facturacion_ARS", "Comision_ARS", "Estado"],
      ...items.map((item) => [
        item.barber_name,
        Number(item.services_done || 0),
        Number(item.revenue_ars || 0),
        Number(item.commission_ars || 0),
        item?.settlement?.status === "settled" ? "Liquidada" : "Pendiente",
      ]),
      [],
      ["Totales", "", "", "", ""],
      [
        "Servicios",
        Number(commissionSummary?.totals?.services_done || 0),
        "Facturacion",
        Number(commissionSummary?.totals?.revenue_ars || 0),
        "",
      ],
      [
        "Comision total",
        Number(commissionSummary?.totals?.commission_ars || 0),
        "Comision liquidada",
        Number(commissionSummary?.totals?.settled_commission_ars || 0),
        "",
      ],
      [
        "Comision pendiente",
        Number(commissionSummary?.totals?.pending_commission_ars || 0),
        "",
        "",
        "",
      ],
    ];

    const csv = rows.map((row) => row.map(escapeCsv).join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comisiones-${monthLabel}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportCommissionsPdf() {
    const items = commissionSummary?.items || [];
    if (!items.length) {
      setCommissionError("No hay datos de comisiones para exportar.");
      return;
    }

    const monthLabel =
      commissionSummary?.month ||
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const branchLabel =
      selectedBranchId && selectedBranchId !== "all"
        ? activeBranches.find((b) => String(b.id) === String(selectedBranchId))?.name ||
          `Sucursal ${selectedBranchId}`
        : "Todas las sucursales";

    const formatMoney = (value) =>
      new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "ARS",
        maximumFractionDigits: 0,
      }).format(Number(value || 0));

    const tableRows = items
      .map(
        (item) => `
      <tr>
        <td>${item.barber_name}</td>
        <td style="text-align:right;">${Number(item.services_done || 0)}</td>
        <td style="text-align:right;">${formatMoney(item.revenue_ars)}</td>
        <td style="text-align:right;">${formatMoney(item.commission_ars)}</td>
        <td>${item?.settlement?.status === "settled" ? "Liquidada" : "Pendiente"}</td>
      </tr>`
      )
      .join("");

    const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Comisiones ${monthLabel}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; margin: 24px; }
    h1 { margin: 0 0 6px; font-size: 20px; }
    p { margin: 0 0 4px; color: #444; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; }
    th { background: #f3f4f6; text-align: left; }
    .totals { margin-top: 18px; }
    .totals div { margin: 4px 0; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Comisiones liquidables</h1>
  <p><strong>Mes:</strong> ${monthLabel}</p>
  <p><strong>Sucursal:</strong> ${branchLabel}</p>

  <table>
    <thead>
      <tr>
        <th>Barbero</th>
        <th>Servicios</th>
        <th>Facturación</th>
        <th>Comisión</th>
        <th>Estado</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <div class="totals">
    <div><strong>Comisión total:</strong> ${formatMoney(commissionSummary?.totals?.commission_ars)}</div>
    <div><strong>Comisión liquidada:</strong> ${formatMoney(commissionSummary?.totals?.settled_commission_ars)}</div>
    <div><strong>Comisión pendiente:</strong> ${formatMoney(commissionSummary?.totals?.pending_commission_ars)}</div>
  </div>

  <script>
    window.onload = () => window.print();
  </script>
</body>
</html>`;

    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) {
      setCommissionError("Tu navegador bloqueó la ventana de impresión.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // best-effort
    } finally {
      clearAuth();
      window.location.href = "/login";
    }
  }

  async function setStatusOnServer(apptId, status) {
    setErr("");
    setSavingId(apptId);

    try {
      await apiFetch(`/appointments/${apptId}/status`, {
        method: "PATCH",
        body: { status },
      });

      setAppointments((prev) =>
        prev.map((a) => (a.id === apptId ? { ...a, status } : a))
      );
    } catch (e) {
      setErr(e.message || "No se pudo actualizar el estado");
    } finally {
      setSavingId(null);
    }
  }

  function updateStatus(id, status) {
    setStatusOnServer(id, status);
  }

  function startCut(id) {
    setStatusOnServer(id, "in_progress");
  }

  async function finalizeWalkInService(barberId) {
    const selectedServiceId = Number(walkInServiceByBarber?.[barberId] || 0);
    if (!Number.isInteger(selectedServiceId) || selectedServiceId <= 0) {
      setErr("Seleccioná un servicio para registrar como finalizado.");
      return;
    }

    setErr("");
    setWalkInSavingBarberId(barberId);
    try {
      await apiFetch("/appointments/walk-in", {
        method: "POST",
        body: {
          barberId,
          serviceId: selectedServiceId,
        },
      });

      setWalkInServiceByBarber((prev) => ({ ...prev, [barberId]: "" }));

      await loadAppointments();

      try {
        const yyyy = date.getFullYear();
        const mm = date.getMonth() + 1;
        const branchQuery =
          session?.role === "admin" && selectedBranchId && selectedBranchId !== "all"
            ? `&branchId=${selectedBranchId}`
            : "";
        const refreshedCash = await apiFetch(
          `/appointments/cash-summary?date=${toDateParam(date)}&year=${yyyy}&month=${mm}${branchQuery}`
        );
        setCashSummary(refreshedCash || null);
      } catch {
        // best effort
      }

      if (session?.role === "admin") {
        try {
          const yyyy = date.getFullYear();
          const mm = date.getMonth() + 1;
          const branchQuery =
            selectedBranchId && selectedBranchId !== "all"
              ? `&branchId=${selectedBranchId}`
              : "";
          const refreshedCommission = await apiFetch(
            `/appointments/commissions-summary?year=${yyyy}&month=${mm}${branchQuery}`
          );
          setCommissionSummary(refreshedCommission || null);
        } catch {
          // best effort
        }
      }
    } catch (e) {
      setErr(e.message || "No se pudo registrar el servicio sin turno.");
    } finally {
      setWalkInSavingBarberId(0);
    }
  }

  function getInProgress(barberId) {
    return (apptsByBarber.get(barberId) || []).find(
      (a) => a.status === "in_progress"
    );
  }

  function getNext(barberId) {
    const list = apptsByBarber.get(barberId) || [];
    const future = list
      .filter((a) => ["pending"].includes(a.status))
      .filter((a) => new Date(a.startAt) >= new Date(now.getTime() - 5 * 60 * 1000));
    return future.sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0];
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-zinc-950/80 backdrop-blur">
        <Container className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm text-zinc-400">Panel</div>
            <div className="text-lg font-black">Tu Estilo - Barbería</div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="hidden sm:block text-sm text-zinc-400">
              Hora:{" "}
              <span className="text-zinc-200 font-semibold">
                {formatTime(now)}
              </span>
            </div>

            <button
              onClick={logout}
              disabled={loggingOut}
              className="rounded-xl px-4 py-2 text-sm font-semibold hover:bg-white/10 max-[420px]:w-full"
            >
              {loggingOut ? "Saliendo..." : "Cerrar sesión"}
            </button>

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
        {loadingCatalog && !barbers.length ? (
          <div className="rounded-xl bg-zinc-900/40 ring-1 ring-white/10 px-4 py-3 text-sm text-zinc-400">
            Cargando barberos y servicios...
          </div>
        ) : null}

        {catalogError ? (
          <div className="mt-4 rounded-xl bg-red-500/10 ring-1 ring-red-500/30 px-4 py-3 text-sm text-red-200">
            {catalogError}
          </div>
        ) : null}

        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-3xl font-black">Agenda del día</h1>
            <p className="mt-2 text-zinc-400">
              Turnos por barbero. Iniciá un corte para ver el contador.
            </p>
          </div>

          {session?.role === "admin" ? (
            <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
              {billingBanner ? (
                <div
                  className={[
                    "mb-3 rounded-xl px-3 py-2 text-xs ring-1",
                    billingBanner.tone === "success"
                      ? "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30"
                      : billingBanner.tone === "warning"
                      ? "bg-amber-500/10 text-amber-200 ring-amber-500/30"
                      : "bg-sky-500/10 text-sky-200 ring-sky-500/30",
                  ].join(" ")}
                >
                  <div className="font-semibold">{billingBanner.title}</div>
                  <div className="mt-1">{billingBanner.text}</div>
                </div>
              ) : null}

              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm text-zinc-400">Suscripción mensual</div>
                  <div className="mt-1 text-base font-semibold text-zinc-100">
                    {billingLoading
                      ? "Cargando estado..."
                      : billingView.title}
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">
                    {billingView.subtitle}
                  </div>
                </div>

                {!billingInfo?.billing?.currentMonthPaid &&
                billingInfo?.onlinePayment?.enabled ? (
                  <button
                    onClick={startMonthlyPayment}
                    disabled={
                      startingCheckout ||
                      billingLoading ||
                      (effectiveOnlinePaymentMode !== "subscription" &&
                        !billingInfo?.billing?.isPaymentWindow)
                    }
                    className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-300 disabled:opacity-60"
                  >
                    {startingCheckout
                      ? "Redirigiendo..."
                      : effectiveOnlinePaymentMode === "subscription"
                      ? "Activar débito automático"
                      : "Pagar mes"}
                  </button>
                ) : null}
              </div>

              {billingError ? (
                <div className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-200 ring-1 ring-red-500/30">
                  {billingError}
                </div>
              ) : null}

              {manualOnlySubscription ? (
                <div className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-500/30">
                  Tu débito automático está pausado o cancelado. Podés continuar con pago mensual manual.
                </div>
              ) : null}

              {!billingInfo?.billing?.currentMonthPaid &&
              billingInfo?.onlinePayment?.enabled &&
              !billingView.inTrial &&
              effectiveOnlinePaymentMode !== "subscription" &&
              !billingInfo?.billing?.isPaymentWindow ? (
                <div className="mt-3 rounded-xl bg-zinc-800/70 px-3 py-2 text-xs text-zinc-300 ring-1 ring-white/10">
                  El pago online desde este panel se habilita del día 1 al 5 de cada mes.
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm text-zinc-400">Caja</div>
                <div className="text-base font-semibold text-zinc-100">
                  Resumen diario y mensual
                </div>
              </div>
              <div className="flex items-center gap-2">
                {cashSummary?.closing?.isClosed ? (
                  <span className="rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-500/30">
                    Caja cerrada
                  </span>
                ) : (
                  <span className="rounded-lg bg-zinc-800 px-2 py-1 text-[11px] font-semibold text-zinc-300 ring-1 ring-white/10">
                    Caja abierta
                  </span>
                )}
                <div className="text-xs text-zinc-400">
                  Basado en turnos finalizados
                </div>
              </div>
            </div>

            {session?.role === "admin" ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => closeCashDay(false)}
                  disabled={cashClosing || cashLoading || !canCloseCashDay}
                  className="rounded-xl bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 ring-1 ring-white/10 hover:bg-zinc-700 disabled:opacity-60"
                >
                  {cashClosing ? "Cerrando..." : "Cerrar caja del día"}
                </button>
                {cashSummary?.closing?.isClosed ? (
                  <button
                    onClick={reopenCashDay}
                    disabled={cashReopening || cashLoading}
                    className="rounded-xl bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 ring-1 ring-white/10 hover:bg-zinc-700 disabled:opacity-60"
                  >
                    {cashReopening ? "Reabriendo..." : "Reabrir caja"}
                  </button>
                ) : null}
                <button
                  onClick={() => exportCashCsv("daily")}
                  disabled={cashLoading}
                  className="rounded-xl bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 ring-1 ring-white/10 hover:bg-zinc-700 disabled:opacity-60"
                >
                  Exportar caja diaria (CSV)
                </button>
                <button
                  onClick={() => exportCashCsv("monthly")}
                  disabled={cashLoading}
                  className="rounded-xl bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 ring-1 ring-white/10 hover:bg-zinc-700 disabled:opacity-60"
                >
                  Exportar caja mensual (CSV)
                </button>
                {!cashLoading && !canCloseCashDay ? (
                  <div className="text-xs text-zinc-500">
                    No hay servicios finalizados para cerrar hoy.
                  </div>
                ) : null}
                {cashSummary?.closing?.isClosed && cashSummary?.closing?.closedAt ? (
                  <div className="text-xs text-zinc-400">
                    Cerrada el{" "}
                    {cashSummary?.closing?.closedAtDisplay || "-"}
                    {cashSummary?.closing?.closedByUser?.name
                      ? ` por ${cashSummary.closing.closedByUser.name}`
                      : ""}
                  </div>
                ) : null}
              </div>
            ) : null}

            {cashMsg ? (
              <div className="mt-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 ring-1 ring-emerald-500/30">
                {cashMsg}
              </div>
            ) : null}

            {cashError ? (
              <div className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-200 ring-1 ring-red-500/30">
                {cashError}
              </div>
            ) : null}

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl bg-zinc-950/60 p-3 ring-1 ring-white/10">
                <div className="text-xs text-zinc-400">Hoy</div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-zinc-400 text-xs">Servicios</div>
                    <div className="font-semibold text-zinc-100">
                      {cashLoading ? "..." : Number(dayCashSource?.services_done || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-400 text-xs">Facturación</div>
                    <div className="font-semibold text-emerald-300">
                      {cashLoading
                        ? "..."
                        : new Intl.NumberFormat("es-AR", {
                            style: "currency",
                            currency: "ARS",
                            maximumFractionDigits: 0,
                          }).format(Number(dayCashSource?.revenue_ars || 0))}
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-400 text-xs">Comisión</div>
                    <div className="font-semibold text-cyan-300">
                      {cashLoading
                        ? "..."
                        : new Intl.NumberFormat("es-AR", {
                            style: "currency",
                            currency: "ARS",
                            maximumFractionDigits: 0,
                          }).format(Number(dayCashSource?.commission_ars || 0))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-zinc-950/60 p-3 ring-1 ring-white/10">
                <div className="text-xs text-zinc-400">Mes actual</div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-zinc-400 text-xs">Servicios</div>
                    <div className="font-semibold text-zinc-100">
                      {cashLoading ? "..." : Number(cashSummary?.monthly?.services_done || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-400 text-xs">Facturación</div>
                    <div className="font-semibold text-emerald-300">
                      {cashLoading
                        ? "..."
                        : new Intl.NumberFormat("es-AR", {
                            style: "currency",
                            currency: "ARS",
                            maximumFractionDigits: 0,
                          }).format(Number(cashSummary?.monthly?.revenue_ars || 0))}
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-400 text-xs">Comisión</div>
                    <div className="font-semibold text-cyan-300">
                      {cashLoading
                        ? "..."
                        : new Intl.NumberFormat("es-AR", {
                            style: "currency",
                            currency: "ARS",
                            maximumFractionDigits: 0,
                          }).format(Number(cashSummary?.monthly?.commission_ars || 0))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="min-w-0 rounded-xl bg-zinc-950/60 p-3 ring-1 ring-white/10">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Por barbero (día)
                </div>
                {!cashLoading && !dayByBarberSource.length ? (
                  <div className="text-xs text-zinc-400">Sin datos para el período.</div>
                ) : (
                  <div className="space-y-1 text-xs">
                    {dayByBarberSource.map((row) => (
                      <div
                        key={row.barber_id}
                        className="flex min-w-0 items-center justify-between gap-2 overflow-hidden rounded-lg bg-zinc-900/60 px-2 py-1 ring-1 ring-white/10"
                      >
                        <div className="min-w-0 flex-1 truncate text-zinc-200">{row.barber_name}</div>
                        <div className="shrink-0 text-right font-semibold text-emerald-300">
                          {new Intl.NumberFormat("es-AR", {
                            style: "currency",
                            currency: "ARS",
                            maximumFractionDigits: 0,
                          }).format(Number(row.revenue_ars || 0))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="min-w-0 rounded-xl bg-zinc-950/60 p-3 ring-1 ring-white/10">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Servicios top (día)
                </div>
                {!cashLoading && !dayByServiceSource.length ? (
                  <div className="text-xs text-zinc-400">Sin datos para el período.</div>
                ) : (
                  <div className="space-y-1 text-xs">
                    {dayByServiceSource.map((row) => (
                      <div
                        key={row.service_id}
                        className="flex min-w-0 items-center justify-between gap-2 overflow-hidden rounded-lg bg-zinc-900/60 px-2 py-1 ring-1 ring-white/10"
                      >
                        <div className="min-w-0 flex-1 truncate text-zinc-200">{row.service_name}</div>
                        <div className="shrink-0 text-right font-semibold text-amber-300">
                          {new Intl.NumberFormat("es-AR", {
                            style: "currency",
                            currency: "ARS",
                            maximumFractionDigits: 0,
                          }).format(Number(row.revenue_ars || 0))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {session?.role === "admin" ? (
            <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm text-zinc-400">Comisiones</div>
                  <div className="text-base font-semibold text-zinc-100">
                    Comisiones liquidables del mes
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs text-zinc-400">
                    Mes {commissionSummary?.month || `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`}
                  </div>
                  <button
                    onClick={exportCommissionsCsv}
                    disabled={commissionLoading}
                    className="rounded-lg bg-zinc-800 px-2 py-1 text-[11px] font-semibold text-zinc-100 ring-1 ring-white/10 disabled:opacity-60"
                  >
                    Exportar CSV
                  </button>
                  <button
                    onClick={exportCommissionsPdf}
                    disabled={commissionLoading}
                    className="rounded-lg bg-zinc-800 px-2 py-1 text-[11px] font-semibold text-zinc-100 ring-1 ring-white/10 disabled:opacity-60"
                  >
                    Exportar PDF
                  </button>
                </div>
              </div>

              {commissionError ? (
                <div className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-200 ring-1 ring-red-500/30">
                  {commissionError}
                </div>
              ) : null}

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl bg-zinc-950/60 p-3 ring-1 ring-white/10">
                  <div className="text-xs text-zinc-400">Comisión total</div>
                  <div className="mt-1 font-semibold text-cyan-300">
                    {new Intl.NumberFormat("es-AR", {
                      style: "currency",
                      currency: "ARS",
                      maximumFractionDigits: 0,
                    }).format(Number(commissionSummary?.totals?.commission_ars || 0))}
                  </div>
                </div>
                <div className="rounded-xl bg-zinc-950/60 p-3 ring-1 ring-white/10">
                  <div className="text-xs text-zinc-400">Liquidada</div>
                  <div className="mt-1 font-semibold text-emerald-300">
                    {new Intl.NumberFormat("es-AR", {
                      style: "currency",
                      currency: "ARS",
                      maximumFractionDigits: 0,
                    }).format(Number(commissionSummary?.totals?.settled_commission_ars || 0))}
                  </div>
                </div>
                <div className="rounded-xl bg-zinc-950/60 p-3 ring-1 ring-white/10">
                  <div className="text-xs text-zinc-400">Pendiente</div>
                  <div className="mt-1 font-semibold text-amber-300">
                    {new Intl.NumberFormat("es-AR", {
                      style: "currency",
                      currency: "ARS",
                      maximumFractionDigits: 0,
                    }).format(Number(commissionSummary?.totals?.pending_commission_ars || 0))}
                  </div>
                </div>
              </div>

              <div className="mt-3 overflow-x-auto rounded-xl ring-1 ring-white/10">
                <table className="min-w-[720px] w-full text-xs">
                  <thead className="bg-white/5 text-zinc-300">
                    <tr>
                      <th className="px-3 py-2 text-left">Barbero</th>
                      <th className="px-3 py-2 text-right">Servicios</th>
                      <th className="px-3 py-2 text-right">Facturación</th>
                      <th className="px-3 py-2 text-right">Comisión</th>
                      <th className="px-3 py-2 text-left">Estado</th>
                      <th className="px-3 py-2 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!commissionLoading && !(commissionSummary?.items || []).length ? (
                      <tr className="border-t border-white/10">
                        <td colSpan={6} className="px-3 py-3 text-zinc-400">
                          Sin comisiones para el período.
                        </td>
                      </tr>
                    ) : (
                      (commissionSummary?.items || []).map((item) => {
                        const settled = item?.settlement?.status === "settled";
                        return (
                          <tr key={item.barber_id} className="border-t border-white/10">
                            <td className="px-3 py-2 text-zinc-200">{item.barber_name}</td>
                            <td className="px-3 py-2 text-right text-zinc-300">{item.services_done}</td>
                            <td className="px-3 py-2 text-right text-emerald-300">
                              {new Intl.NumberFormat("es-AR", {
                                style: "currency",
                                currency: "ARS",
                                maximumFractionDigits: 0,
                              }).format(Number(item.revenue_ars || 0))}
                            </td>
                            <td className="px-3 py-2 text-right text-cyan-300">
                              {new Intl.NumberFormat("es-AR", {
                                style: "currency",
                                currency: "ARS",
                                maximumFractionDigits: 0,
                              }).format(Number(item.commission_ars || 0))}
                            </td>
                            <td className="px-3 py-2">
                              {settled ? (
                                <span className="rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-500/30">
                                  Liquidada
                                </span>
                              ) : (
                                <span className="rounded-lg bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-500/30">
                                  Pendiente
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {settled ? (
                                <button
                                  onClick={() => reopenCommission(item.barber_id)}
                                  disabled={commissionSavingBarberId === item.barber_id}
                                  className="rounded-lg bg-zinc-800 px-2 py-1 text-[11px] font-semibold text-zinc-100 ring-1 ring-white/10 disabled:opacity-60"
                                >
                                  {commissionSavingBarberId === item.barber_id ? "Guardando..." : "Reabrir"}
                                </button>
                              ) : (
                                <button
                                  onClick={() => settleCommission(item.barber_id)}
                                  disabled={commissionSavingBarberId === item.barber_id}
                                  className="rounded-lg bg-amber-400 px-2 py-1 text-[11px] font-semibold text-zinc-950 disabled:opacity-60"
                                >
                                  {commissionSavingBarberId === item.barber_id ? "Guardando..." : "Liquidar"}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="sticky top-[74px] z-30 rounded-2xl border border-white/10 bg-zinc-950/80 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur">
            <div className="mx-auto flex w-full max-w-[980px] flex-col items-stretch gap-3 xl:flex-row xl:items-end xl:justify-center xl:gap-2">
              <div className="w-full xl:w-[188px]">
                <input
                  type="date"
                  aria-label="Fecha de agenda"
                  value={toDateParam(date)}
                  onChange={(e) => setDate(parseDateParam(e.target.value))}
                  className="h-10 w-full rounded-xl bg-zinc-900/50 px-3 text-sm text-zinc-200 ring-1 ring-white/10 [color-scheme:dark]"
                />
              </div>

              <Button
                onClick={loadAppointments}
                disabled={loading || barberWindowsLoading}
                className="h-10 w-full whitespace-nowrap px-5 xl:w-auto"
              >
                {loading || barberWindowsLoading ? "Cargando..." : "Actualizar"}
              </Button>

              {session?.role === "admin" && activeBranches.length > 1 ? (
                <select
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  className="h-10 w-full rounded-xl bg-zinc-900/50 px-4 py-2 text-sm ring-1 ring-white/10 xl:w-[220px]"
                >
                  <option value="all">Todas las sucursales</option>
                  {activeBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : null}

              {/* ✅ Botón a Ranking solo para admin */}
              {session?.role === "admin" ? (
                <>
                  <Link
                    to="/admin/ranking"
                    className="inline-flex h-10 w-full items-center justify-center whitespace-nowrap rounded-xl bg-zinc-900/50 px-4 text-center text-sm font-semibold ring-1 ring-white/10 hover:bg-white/5 xl:w-auto"
                  >
                    Ranking e historial
                  </Link>
                  <Link
                    to="/admin/settings"
                    className="inline-flex h-10 w-full items-center justify-center whitespace-nowrap rounded-xl bg-zinc-900/50 px-4 text-center text-sm font-semibold ring-1 ring-white/10 hover:bg-white/5 xl:w-auto"
                  >
                    Configuración
                  </Link>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div
          className={[
            "mt-8 grid gap-4",
            visibleBarbers.length === 1
              ? "lg:grid-cols-1"
              : visibleBarbers.length === 2
              ? "lg:grid-cols-2"
              : "lg:grid-cols-3",
          ].join(" ")}
        >
          {visibleBarbers.map((b) => {
            const list = apptsByBarber.get(b.id) || [];
            const slots = slotsByBarber.get(b.id) || [];
            const inProg = getInProgress(b.id);
            const next = getNext(b.id);
            const statusesInMainGrid = new Set(["pending", "in_progress", "done"]);
            const matchedAppointmentIds = new Set(
              slots
                .map((s) => {
                  const appt = list.find((a) => {
                    const t = new Date(a.startAt).getTime();
                    return (
                      t >= s.start.getTime() &&
                      t < s.end.getTime() &&
                      statusesInMainGrid.has(a.status)
                    );
                  });
                  return appt?.id || null;
                })
                .filter(Boolean)
            );
            const appointmentsOutsideGrid = list.filter((a) => !matchedAppointmentIds.has(a.id));

            let remaining = null;
            if (inProg) {
              const end = new Date(inProg.endAt);
              remaining = end.getTime() - now.getTime();
            }

            return (
              <div
                key={b.id}
                className="rounded-2xl bg-zinc-900/40 ring-1 ring-white/10 overflow-hidden"
              >
                <div className="p-4 border-b border-white/10 flex items-center justify-between">
                  <div>
                    <div className="font-bold">{b.name}</div>
                    <div className="text-xs text-zinc-400">{b.role}</div>
                  </div>

                  {inProg ? (
                    <div className={statusBadge("in_progress")}>
                      En curso · {msToMMSS(remaining ?? 0)}
                    </div>
                  ) : next ? (
                    <div className={statusBadge("pending")}>
                      Próximo · {formatTime(new Date(next.startAt))}
                    </div>
                  ) : (
                    <div className={statusBadge("done")}>Sin pendientes</div>
                  )}
                </div>

                <div className="p-4 space-y-3 max-h-[70vh] overflow-auto">
                  {session?.role === "barber" ? (
                    <div className="rounded-2xl bg-zinc-950/40 p-3 ring-1 ring-white/10">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-cyan-300">
                        Servicio sin turno
                      </div>

                      {billableServices.length ? (
                        <>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {billableServices.map((svc) => {
                              const selected = Number(walkInServiceByBarber?.[b.id] || 0) === Number(svc.id);
                              return (
                                <button
                                  key={`walkin-service-${b.id}-${svc.id}`}
                                  type="button"
                                  onClick={() =>
                                    setWalkInServiceByBarber((prev) => ({
                                      ...prev,
                                      [b.id]: String(svc.id),
                                    }))
                                  }
                                  className={[
                                    "rounded-xl px-3 py-2 text-left ring-1 transition",
                                    selected
                                      ? "bg-cyan-400/20 text-cyan-100 ring-cyan-300/50"
                                      : "bg-zinc-950/50 text-zinc-200 ring-white/10 hover:ring-white/20",
                                  ].join(" ")}
                                >
                                  <div className="text-sm font-semibold">{svc.name}</div>
                                  <div className="text-xs text-zinc-400">
                                    {svc.durationMin} min · {formatArs(svc.price)}
                                  </div>
                                </button>
                              );
                            })}
                          </div>

                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs text-zinc-400">
                              Seleccioná el servicio realizado y registralo como finalizado.
                            </div>
                            <button
                              type="button"
                              onClick={() => finalizeWalkInService(b.id)}
                              disabled={walkInSavingBarberId === b.id}
                              className="rounded-xl bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-300 disabled:opacity-60"
                            >
                              {walkInSavingBarberId === b.id ? "Registrando..." : "Finalizar servicio"}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-zinc-400">
                          No hay servicios cobrables activos para registrar.
                        </div>
                      )}
                    </div>
                  ) : null}

                  {slots.map((s) => {
                    const appt = list.find((a) => {
                      const t = new Date(a.startAt).getTime();
                      return (
                        t >= s.start.getTime() &&
                        t < s.end.getTime() &&
                        statusesInMainGrid.has(a.status)
                      );
                    });

                    const isInProgress = appt?.status === "in_progress";
                    const isNowSlot = now >= s.start && now < s.end && !appt;
                    const isSaving = !!appt && savingId === appt.id;

                    return (
                      <div
                        key={s.start.toISOString()}
                        className={[
                          "rounded-2xl ring-1 p-3 transition",
                          appt ? "bg-zinc-950/40 ring-white/10" : "bg-zinc-950/20 ring-white/5",
                          isInProgress ? "ring-amber-300 bg-amber-400/10" : "",
                          isNowSlot ? "ring-white/20" : "",
                          isSaving ? "opacity-70" : "",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-xs text-zinc-400">
                              {formatTime(s.start)} - {formatTime(s.end)}
                            </div>

                            {appt ? (
                              <>
                                <div className="mt-1 font-semibold">{appt.customerName}</div>
                                {appt.customerPhone ? (
                                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                                    <span>{appt.customerPhone}</span>
                                    <a
                                      href={`https://wa.me/${String(appt.customerPhone).replace(/\D/g, "")}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/30"
                                      aria-label={`Abrir WhatsApp de ${appt.customerName || "cliente"}`}
                                    >
                                      WA
                                    </a>
                                  </div>
                                ) : null}
                                <div className="text-xs text-zinc-400">
                                  {appt.serviceNameSnapshot ||
                                    serviceById.get(appt.serviceId)?.name ||
                                    "Servicio"}
                                  {" · "}
                                  {appt.serviceDurationSnapshot ||
                                    serviceById.get(appt.serviceId)?.durationMin ||
                                    30} min
                                </div>
                              </>
                            ) : (
                              <div className="mt-1 text-sm text-zinc-500">Libre</div>
                            )}
                          </div>

                          <div className="flex flex-col items-end gap-2">
                            {appt ? (
                              <span className={statusBadge(appt.status)}>
                                {appt.status === "pending"
                                  ? "Pendiente"
                                  : appt.status === "in_progress"
                                  ? "En curso"
                                  : appt.status === "done"
                                  ? "Finalizado"
                                  : appt.status === "no_show"
                                  ? "No vino"
                                  : "Cancelado"}
                              </span>
                            ) : null}

                            {appt?.status === "pending" ? (
                              <div className="flex flex-wrap justify-end gap-2">
                                <button
                                  disabled={isSaving}
                                  onClick={() => startCut(appt.id)}
                                  className="rounded-xl px-3 py-1.5 text-xs font-semibold bg-amber-400 text-zinc-950 hover:bg-amber-300 disabled:opacity-60"
                                >
                                  {isSaving ? "Guardando..." : "Iniciar"}
                                </button>
                                <button
                                  disabled={isSaving}
                                  onClick={() => updateStatus(appt.id, "no_show")}
                                  className="rounded-xl px-3 py-1.5 text-xs font-semibold hover:bg-white/10 disabled:opacity-60"
                                >
                                  No vino
                                </button>
                              </div>
                            ) : null}

                            {appt?.status === "in_progress" ? (
                              <div className="flex flex-wrap justify-end gap-2">
                                <button
                                  disabled={isSaving}
                                  onClick={() => updateStatus(appt.id, "done")}
                                  className="rounded-xl px-3 py-1.5 text-xs font-semibold bg-emerald-400 text-zinc-950 hover:bg-emerald-300 disabled:opacity-60"
                                >
                                  {isSaving ? "Guardando..." : "Finalizar"}
                                </button>
                                <button
                                  disabled={isSaving}
                                  onClick={() => updateStatus(appt.id, "cancelled")}
                                  className="rounded-xl px-3 py-1.5 text-xs font-semibold hover:bg-white/10 disabled:opacity-60"
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {isInProgress ? (
                          <div className="mt-3 text-xs text-zinc-300">
                            Termina en{" "}
                            <span className="font-semibold">
                              {msToMMSS(new Date(appt.endAt).getTime() - now.getTime())}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  {appointmentsOutsideGrid.length ? (
                    <div className="mt-2 rounded-2xl bg-zinc-900/30 p-3 ring-1 ring-white/10">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-300">
                        Turnos fuera de grilla horaria
                      </div>
                      <div className="space-y-2">
                        {appointmentsOutsideGrid.map((appt) => {
                          const isSaving = savingId === appt.id;
                          return (
                            <div
                              key={`outside-${appt.id}`}
                              className="rounded-xl bg-zinc-950/40 p-3 ring-1 ring-white/10"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-xs text-zinc-400">
                                    {formatTime(new Date(appt.startAt))} -{" "}
                                    {formatTime(new Date(appt.endAt))}
                                  </div>
                                  <div className="mt-1 font-semibold">{appt.customerName}</div>
                                  {appt.customerPhone ? (
                                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                                      <span>{appt.customerPhone}</span>
                                      <a
                                        href={`https://wa.me/${String(appt.customerPhone).replace(/\D/g, "")}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/30"
                                        aria-label={`Abrir WhatsApp de ${appt.customerName || "cliente"}`}
                                      >
                                        WA
                                      </a>
                                    </div>
                                  ) : null}
                                  <div className="text-xs text-zinc-400">
                                    {appt.serviceNameSnapshot ||
                                      serviceById.get(appt.serviceId)?.name ||
                                      "Servicio"}
                                    {" · "}
                                    {appt.serviceDurationSnapshot ||
                                      serviceById.get(appt.serviceId)?.durationMin ||
                                      30}{" "}
                                    min
                                  </div>
                                </div>

                                <div className="flex flex-col items-end gap-2">
                                  <span className={statusBadge(appt.status)}>
                                    {appt.status === "pending"
                                      ? "Pendiente"
                                      : appt.status === "in_progress"
                                      ? "En curso"
                                      : appt.status === "done"
                                      ? "Finalizado"
                                      : appt.status === "no_show"
                                      ? "No vino"
                                      : "Cancelado"}
                                  </span>

                                  {appt.status === "pending" ? (
                                    <div className="flex flex-wrap justify-end gap-2">
                                      <button
                                        disabled={isSaving}
                                        onClick={() => startCut(appt.id)}
                                        className="rounded-xl px-3 py-1.5 text-xs font-semibold bg-amber-400 text-zinc-950 hover:bg-amber-300 disabled:opacity-60"
                                      >
                                        {isSaving ? "Guardando..." : "Iniciar"}
                                      </button>
                                      <button
                                        disabled={isSaving}
                                        onClick={() => updateStatus(appt.id, "no_show")}
                                        className="rounded-xl px-3 py-1.5 text-xs font-semibold hover:bg-white/10 disabled:opacity-60"
                                      >
                                        No vino
                                      </button>
                                    </div>
                                  ) : null}

                                  {appt.status === "in_progress" ? (
                                    <div className="flex flex-wrap justify-end gap-2">
                                      <button
                                        disabled={isSaving}
                                        onClick={() => updateStatus(appt.id, "done")}
                                        className="rounded-xl px-3 py-1.5 text-xs font-semibold bg-emerald-400 text-zinc-950 hover:bg-emerald-300 disabled:opacity-60"
                                      >
                                        {isSaving ? "Guardando..." : "Finalizar"}
                                      </button>
                                      <button
                                        disabled={isSaving}
                                        onClick={() => updateStatus(appt.id, "cancelled")}
                                        className="rounded-xl px-3 py-1.5 text-xs font-semibold hover:bg-white/10 disabled:opacity-60"
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {err && (
          <div className="mt-6 rounded-xl bg-red-500/10 ring-1 ring-red-500/30 px-4 py-3 text-sm text-red-200">
            {err}
          </div>
        )}

        <div className="mt-10 rounded-2xl bg-zinc-900/40 ring-1 ring-white/10 p-4 text-sm text-zinc-400">
          Este panel carga turnos reales y permite actualizar su estado en forma simple.
        </div>
      </Container>
    </div>
  );
}

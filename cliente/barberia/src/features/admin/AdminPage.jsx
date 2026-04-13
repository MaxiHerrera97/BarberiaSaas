
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
  const slots = useMemo(() => buildDaySlots(date), [date]);

  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [savingId, setSavingId] = useState(null);
  const activeBranches = useMemo(
    () => (Array.isArray(branches) ? branches.filter((b) => !!b.isActive) : []),
    [branches]
  );
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [billingInfo, setBillingInfo] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [startingCheckout, setStartingCheckout] = useState(false);

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

  async function startMonthlyPayment() {
    if (startingCheckout) return;
    setStartingCheckout(true);
    setBillingError("");
    try {
      const data = await apiFetch("/billing/public/mercadopago/checkout", {
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
              Turnos por barbero (bloques de 30 min). Iniciá un corte para ver el contador.
            </p>
          </div>

          {session?.role === "admin" ? (
            <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm text-zinc-400">Suscripción mensual</div>
                  <div className="mt-1 text-base font-semibold text-zinc-100">
                    {billingLoading
                      ? "Cargando estado..."
                      : billingInfo?.billing?.currentMonthPaid
                      ? "Mes pagado"
                      : "Mes pendiente"}
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">
                    Mes {billingInfo?.billing?.billingMonth || "-"} · vence día{" "}
                    {billingInfo?.billing?.dueDay || 5} · ARS{" "}
                    {billingInfo?.billing?.monthlyFeeArs || 30000}
                  </div>
                </div>

                {!billingInfo?.billing?.currentMonthPaid &&
                billingInfo?.onlinePayment?.enabled ? (
                  <button
                    onClick={startMonthlyPayment}
                    disabled={startingCheckout || billingLoading}
                    className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-300 disabled:opacity-60"
                  >
                    {startingCheckout ? "Redirigiendo..." : "Pagar mes"}
                  </button>
                ) : null}
              </div>

              {billingError ? (
                <div className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-200 ring-1 ring-red-500/30">
                  {billingError}
                </div>
              ) : null}
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
                disabled={loading}
                className="h-10 w-full whitespace-nowrap px-5 xl:w-auto"
              >
                {loading ? "Cargando..." : "Actualizar"}
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
            const inProg = getInProgress(b.id);
            const next = getNext(b.id);

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
                  {slots.map((s) => {
                    const appt = list.find((a) => {
                      const t = new Date(a.startAt).getTime();
                      return t >= s.start.getTime() && t < s.end.getTime();
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
                                <div className="text-xs text-zinc-400">
                                  {serviceById.get(appt.serviceId)?.name ?? "Servicio"}
                                  {" · "}
                                  {serviceById.get(appt.serviceId)?.durationMin ?? 30} min
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
          Este panel carga turnos reales desde el backend y permite cambiar estado (pending/in_progress/done/etc.).
        </div>
      </Container>
    </div>
  );
}

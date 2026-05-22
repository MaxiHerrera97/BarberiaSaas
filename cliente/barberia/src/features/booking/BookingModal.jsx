
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "../../ui/Modal";
import Button from "../../ui/Button";
import { apiFetch } from "../../lib/api";
import { parseMySQLDateTimeLocal } from "../../lib/time";
import {
  addDays,
  buildSlots,
  formatDate,
  formatTime,
  startOfDay,
} from "./booking.utils";

/** ✅ YYYY-MM-DD HH:mm:ss en HORA LOCAL */
function toMySQLDateTimeLocal(d) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

// ✅ yyyy-mm-dd
function toDateParam(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ✅ helpers teléfono AR
function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}
function isValidArPhone(digits) {
  // según tu ejemplo: 10 dígitos (3813686226)
  return /^\d{10}$/.test(digits);
}

const CALENDAR_CACHE_TTL_MS = 60 * 1000;
const AVAILABILITY_CACHE_TTL_MS = 30 * 1000;

export default function BookingModal({
  open,
  onClose,
  branches = [],
  barbers,
  services,
  contactWhatsapp = "",
  bookingPaymentRequired = false,
}) {
  const [step, setStep] = useState(1);

  const [branchId, setBranchId] = useState(null);
  const [barberId, setBarberId] = useState(null);
  const [serviceId, setServiceId] = useState(null);
  const [date, setDate] = useState(startOfDay(new Date()));
  const [slot, setSlot] = useState(null);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");

  // hold
  const [holdToken, setHoldToken] = useState(null);
  const [loadingHold, setLoadingHold] = useState(false);
  const [loadingConfirm, setLoadingConfirm] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // disponibilidad real (appointments + holds)
  const [busyRanges, setBusyRanges] = useState([]);
  const [loadingBusy, setLoadingBusy] = useState(false);
  const [availableDates, setAvailableDates] = useState([]);
  const [dayWindows, setDayWindows] = useState([]);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const barberCalendarCacheRef = useRef(new Map());
  const availabilityCacheRef = useRef(new Map());
  const skipReleaseOnUnmountRef = useRef(false);

  const activeBranches = useMemo(
    () => (Array.isArray(branches) ? branches.filter((b) => !!b.isActive) : []),
    [branches]
  );
  const showBranchStep = activeBranches.length > 1;
  const totalSteps = showBranchStep ? 5 : 4;
  const branchStep = showBranchStep ? 1 : 0;
  const barberStep = showBranchStep ? 2 : 1;
  const serviceStep = showBranchStep ? 3 : 2;
  const dateStep = showBranchStep ? 4 : 3;
  const scheduleStep = showBranchStep ? 5 : 4;

  const barber = barbers.find((b) => b.id === barberId);
  const service = services.find((s) => s.id === serviceId);
  const filteredBarbers = useMemo(() => {
    if (!showBranchStep) return barbers;
    if (!branchId) return [];
    return barbers.filter((b) => Number(b.branchId) === Number(branchId));
  }, [barbers, showBranchStep, branchId]);

  // ✅ 14 días visibles para luego marcar disponibles según calendario del barbero
  const days = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => addDays(new Date(), i));
  }, []);

  const phoneDigits = useMemo(() => onlyDigits(customerPhone), [customerPhone]);
  const phoneValid = useMemo(() => isValidArPhone(phoneDigits), [phoneDigits]);
  const whatsappDigits = useMemo(() => String(contactWhatsapp || "").replace(/\D/g, ""), [contactWhatsapp]);

  function openQuoteWhatsApp(serviceName) {
    if (!whatsappDigits) {
      setErrorMsg("La barbería todavía no configuró WhatsApp para pedir presupuestos.");
      return;
    }
    const msg = `Hola! Quiero pedir presupuesto para el servicio: ${serviceName}.`;
    const url = `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const getBarberCalendarCacheKey = useCallback(
    () => `${barberId || 0}|${branchId || 0}`,
    [barberId, branchId]
  );

  const getAvailabilityCacheKey = useCallback(
    (dateObj = date) => `${barberId || 0}|${branchId || 0}|${toDateParam(dateObj)}`,
    [barberId, branchId, date]
  );

  /** ✅ Libera el hold actual si existe */
  async function releaseHold() {
    if (!holdToken) return;
    const token = holdToken;

    setHoldToken(null);
    setSlot(null);

    try {
      await apiFetch(`/appointments/hold/${token}`, { method: "DELETE" });
      availabilityCacheRef.current.delete(getAvailabilityCacheKey());
    } catch {
      // best-effort
    }
  }

  /** ✅ Cierre “seguro”: libera hold y recién ahí cierra */
  async function safeClose() {
    await releaseHold();
    onClose?.();
  }

  /** ✅ Reset total: libera hold y reinicia todo */
  async function resetAllAndClose() {
    await releaseHold();

    setStep(1);
    setBranchId(null);
    setBarberId(null);
    setServiceId(null);
    setDate(startOfDay(new Date()));
    setSlot(null);

    setCustomerName("");
    setCustomerPhone("");
    setPhoneError("");

    setBusyRanges([]);
    setAvailableDates([]);
    setDayWindows([]);
    setErrorMsg("");
    setLoadingHold(false);
    setLoadingConfirm(false);
    setLoadingBusy(false);
    barberCalendarCacheRef.current.clear();
    availabilityCacheRef.current.clear();

    onClose?.();
  }

  // 🔁 Si se desmonta con hold activo, intentamos liberar (best-effort)
  useEffect(() => {
    return () => {
      if (holdToken && !skipReleaseOnUnmountRef.current) {
        apiFetch(`/appointments/hold/${holdToken}`, { method: "DELETE" }).catch(
          () => {}
        );
      }
    };
  }, [holdToken]);

  useEffect(() => {
    if (!open) return;
    if (!activeBranches.length) return;
    if (!showBranchStep) {
      setBranchId(activeBranches[0].id);
      return;
    }
    if (!branchId || !activeBranches.some((b) => Number(b.id) === Number(branchId))) {
      setBranchId(activeBranches[0].id);
      setBarberId(null);
    }
  }, [open, showBranchStep, activeBranches, branchId]);

  useEffect(() => {
    let alive = true;
    async function loadBarberCalendar() {
      if (!open) return;
      if (!barberId) return;
      if (showBranchStep && !branchId) return;

      const cacheKey = getBarberCalendarCacheKey();
      const cached = barberCalendarCacheRef.current.get(cacheKey);
      if (cached && Date.now() - cached.fetchedAt < CALENDAR_CACHE_TTL_MS) {
        if (!alive) return;
        const dates = Array.isArray(cached?.availableDates) ? cached.availableDates : [];
        setAvailableDates(dates);
        if (dates.length && !dates.includes(toDateParam(date))) {
          const nextDate = new Date(`${dates[0]}T00:00:00`);
          setDate(startOfDay(nextDate));
        }
        return;
      }

      setLoadingCalendar(true);
      try {
        const from = toDateParam(new Date());
        const data = await apiFetch(
          `/appointments/barber-calendar?barberId=${barberId}&from=${from}&days=14`
        );
        const dates = Array.isArray(data?.availableDates) ? data.availableDates : [];
        barberCalendarCacheRef.current.set(cacheKey, {
          fetchedAt: Date.now(),
          availableDates: dates,
        });
        if (!alive) return;
        setAvailableDates(dates);
        if (dates.length && !dates.includes(toDateParam(date))) {
          const nextDate = new Date(`${dates[0]}T00:00:00`);
          setDate(startOfDay(nextDate));
        }
      } catch {
        if (!alive) return;
        setAvailableDates([]);
      } finally {
        if (alive) setLoadingCalendar(false);
      }
    }
    loadBarberCalendar();
    return () => {
      alive = false;
    };
  }, [open, barberId, showBranchStep, branchId, date, getBarberCalendarCacheKey]);

  // ✅ Cargar disponibilidad real (appointments + holds) en step 5
  useEffect(() => {
    let alive = true;

    async function loadAvailability() {
      if (!open) return;
      if (step !== scheduleStep) return;
      if (!barberId) return;

      try {
        const dateStr = toDateParam(date);
        const cacheKey = getAvailabilityCacheKey(date);
        const cached = availabilityCacheRef.current.get(cacheKey);
        if (cached && Date.now() - cached.fetchedAt < AVAILABILITY_CACHE_TTL_MS) {
          if (!alive) return;
          setBusyRanges(Array.isArray(cached?.busyRanges) ? cached.busyRanges : []);
          setDayWindows(Array.isArray(cached?.dayWindows) ? cached.dayWindows : []);
          return;
        }

        setLoadingBusy(true);
        setErrorMsg("");

        const data = await apiFetch(
          `/appointments/availability?date=${dateStr}&barberId=${barberId}${
            branchId ? `&branchId=${branchId}` : ""
          }`
        );

        const appts = Array.isArray(data?.appointments) ? data.appointments : [];
        const holds = Array.isArray(data?.holds) ? data.holds : [];

        const ranges = [
          ...appts.map((r) => ({
            start: parseMySQLDateTimeLocal(r.start_at),
            end: parseMySQLDateTimeLocal(r.end_at),
            kind: "appointment",
            status: r.status,
          })),
          ...holds.map((h) => ({
            start: parseMySQLDateTimeLocal(h.start_at),
            end: parseMySQLDateTimeLocal(h.end_at),
            kind: "hold",
          })),
        ];

        availabilityCacheRef.current.set(cacheKey, {
          fetchedAt: Date.now(),
          busyRanges: ranges,
          dayWindows: Array.isArray(data?.dayWindows) ? data.dayWindows : [],
        });

        if (alive) {
          setBusyRanges(ranges);
          setDayWindows(Array.isArray(data?.dayWindows) ? data.dayWindows : []);
        }
      } catch {
        if (alive) {
          setBusyRanges([]);
          setDayWindows([]);
        }
      } finally {
        if (alive) setLoadingBusy(false);
      }
    }

    loadAvailability();
    return () => {
      alive = false;
    };
  }, [open, step, barberId, date, branchId, scheduleStep, getAvailabilityCacheKey]);

  // ✅ slots dentro de ventanas reales + busy marcado (lo hace buildSlots)
  const slots = useMemo(() => {
    if (!service) return [];
    return buildSlots(date, service.durationMin, busyRanges, dayWindows);
  }, [date, service, busyRanges, dayWindows]);

  function next() {
    if (step < totalSteps) setStep(step + 1);
  }

  async function back() {
    if (step === scheduleStep) await releaseHold();
    if (step > 1) setStep(step - 1);
  }

  const selectedDateIsAvailable = availableDates.includes(toDateParam(date));
  const dateStepReady = !loadingCalendar && selectedDateIsAvailable;
  const lockBackByStep = step === dateStep ? loadingCalendar : step === scheduleStep ? loadingBusy : false;
  const lockNextByStep = step === dateStep ? loadingCalendar : step === scheduleStep ? loadingBusy : false;

  const canNext =
    (showBranchStep && step === branchStep && !!branchId) ||
    (step === barberStep && !!barberId) ||
    (step === serviceStep && !!serviceId) ||
    (step === dateStep && dateStepReady);

  const canConfirm = !loadingBusy && !!holdToken && !!customerName.trim() && phoneValid;

  async function pickSlot(s) {
    if (s.status !== "free") return;
    if (s.start.getTime() < Date.now()) {
      setErrorMsg("Ese horario ya pasó. Elegí uno actual o futuro.");
      return;
    }

    setErrorMsg("");
    setLoadingHold(true);

    try {
      await releaseHold();

      const data = await apiFetch("/appointments/hold", {
        method: "POST",
        body: {
          branchId: branchId || undefined,
          barberId,
          serviceId,
          startAt: toMySQLDateTimeLocal(s.start),
          endAt: toMySQLDateTimeLocal(s.end),
        },
      });

      setSlot(s);
      setHoldToken(data.holdToken);
    } catch (e) {
      setSlot(null);
      setHoldToken(null);
      setErrorMsg(e.message || "No se pudo reservar el horario.");
    } finally {
      setLoadingHold(false);
    }
  }

  async function confirm() {
    setErrorMsg("");

    // ✅ validación final front (por si quedó algo raro)
    if (!customerName.trim()) {
      setErrorMsg("Ingresá tu nombre para confirmar.");
      return;
    }
    if (!phoneValid) {
      setPhoneError("Formato inválido. Ejemplo: 3813686226 (10 dígitos).");
      return;
    }

    setLoadingConfirm(true);

    try {
      const data = await apiFetch("/appointments/confirm", {
        method: "POST",
        body: {
          holdToken,
          customerName: customerName.trim(),
          customerPhone: phoneDigits, // ✅ solo dígitos
        },
      });

      if (data?.requiresPayment && data?.checkoutUrl) {
        skipReleaseOnUnmountRef.current = true;
        window.location.href = data.checkoutUrl;
        return;
      }

      alert("Turno confirmado ✅");
      await resetAllAndClose();
    } catch (e) {
      setErrorMsg(e.message || "No se pudo confirmar el turno.");
    } finally {
      setLoadingConfirm(false);
    }
  }

  const footer = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <button
        onClick={back}
        disabled={step === 1 || loadingHold || loadingConfirm || lockBackByStep}
        className="order-2 rounded-xl px-4 py-2 text-sm font-semibold hover:bg-white/10 disabled:opacity-40 sm:order-1"
      >
        Atrás
      </button>

      {step < totalSteps && (
        <Button
          onClick={next}
          disabled={!canNext || loadingHold || loadingConfirm || lockNextByStep}
          className="order-1 w-full sm:order-2 sm:w-auto"
        >
          Siguiente
        </Button>
      )}

      {step === scheduleStep && (
        <Button
          onClick={confirm}
          disabled={!canConfirm || loadingHold || loadingConfirm || loadingBusy}
          className={[!canConfirm ? "opacity-50" : "", "order-1 w-full sm:order-2 sm:w-auto"].join(" ")}
        >
          {loadingConfirm
            ? "Confirmando..."
            : bookingPaymentRequired
            ? "Ir a pagar y confirmar"
            : "Confirmar turno"}
        </Button>
      )}
    </div>
  );

  return (
    <Modal open={open} onClose={safeClose} title="Sacar turno" footer={footer}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        {(showBranchStep
          ? ["Sucursal", "Barbero", "Servicio", "Fecha", "Horario"]
          : ["Barbero", "Servicio", "Fecha", "Horario"]
        ).map((l, i) => (
          <span key={l} className={step === i + 1 ? "text-amber-300" : ""}>
            {l}
          </span>
        ))}
      </div>

      <div className={["mt-5", step === scheduleStep ? "pb-24" : ""].join(" ")}>
        {showBranchStep && step === branchStep && (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {activeBranches.map((b) => (
              <button
                key={b.id}
                onClick={async () => {
                  await releaseHold();
                  setBranchId(b.id);
                  setBarberId(null);
                  setServiceId(null);
                  setErrorMsg("");
                }}
                className={[
                  "rounded-2xl p-4 text-left ring-1 transition",
                  branchId === b.id
                    ? "bg-amber-400 text-zinc-950 ring-amber-300"
                    : "bg-zinc-950/40 ring-white/10 hover:ring-white/20",
                ].join(" ")}
              >
                <div className="font-bold">{b.name}</div>
              </button>
            ))}
          </div>
        )}

        {step === barberStep && (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {filteredBarbers.map((b) => (
              <button
                key={b.id}
                onClick={async () => {
                  await releaseHold();
                  setBarberId(b.id);
                  setDate(startOfDay(new Date()));
                  setErrorMsg("");
                }}
                className={[
                  "rounded-2xl p-4 text-left ring-1 transition",
                  barberId === b.id
                    ? "bg-amber-400 text-zinc-950 ring-amber-300"
                    : "bg-zinc-950/40 ring-white/10 hover:ring-white/20",
                ].join(" ")}
              >
                <div className="font-bold">{b.name}</div>
                <div className="text-xs opacity-80">{b.role}</div>
              </button>
            ))}
          </div>
        )}

        {step === serviceStep && (
          <div className="grid gap-3">
            {services.map((s) => (
              s.quoteOnly ? (
                <div
                  key={s.id}
                  className="rounded-2xl bg-zinc-950/40 p-4 text-left ring-1 ring-white/10"
                >
                  <div className="font-bold">{s.name}</div>
                  <div className="mt-1 text-xs opacity-80">
                    Este servicio se cotiza por WhatsApp.
                  </div>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => openQuoteWhatsApp(s.name)}
                      className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-400"
                    >
                      Pedir presupuesto
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  key={s.id}
                  onClick={async () => {
                    await releaseHold();
                    setServiceId(s.id);
                    setErrorMsg("");
                  }}
                  className={[
                    "rounded-2xl p-4 text-left ring-1 transition",
                    serviceId === s.id
                      ? "bg-amber-400 text-zinc-950 ring-amber-300"
                      : "bg-zinc-950/40 ring-white/10 hover:ring-white/20",
                  ].join(" ")}
                >
                  <div className="font-bold">{s.name}</div>
                  <div className="text-xs opacity-80">
                    {s.durationMin} min · ${s.price}
                  </div>
                </button>
              )
            ))}
          </div>
        )}

        {step === dateStep && (
          <div className="space-y-3">
            {loadingCalendar ? (
              <div className="rounded-xl bg-zinc-950/40 p-3 text-sm text-zinc-400 ring-1 ring-white/10">
                Cargando días disponibles del barbero...
              </div>
            ) : null}
            {!loadingCalendar && !availableDates.length ? (
              <div className="rounded-xl bg-zinc-950/40 p-3 text-sm text-zinc-400 ring-1 ring-white/10">
                Este barbero no tiene días disponibles en los próximos 14 días.
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {days.map((d) => {
              const dateKey = toDateParam(d);
              const enabled = availableDates.includes(dateKey);
              const selected = d.toDateString() === date.toDateString();
              return (
                <button
                  key={d.toISOString()}
                  onClick={async () => {
                    await releaseHold();
                    setDate(startOfDay(d));
                    setErrorMsg("");
                  }}
                  disabled={!enabled}
                  className={[
                    "rounded-xl px-3 py-3 text-sm font-semibold ring-1 transition",
                    selected
                      ? "bg-amber-400 text-zinc-950 ring-amber-300"
                      : enabled
                      ? "bg-zinc-950/40 ring-white/10 hover:ring-white/20"
                      : "bg-zinc-950/20 text-zinc-600 ring-white/5 cursor-not-allowed",
                  ].join(" ")}
                >
                  {formatDate(d)}
                </button>
              );
            })}
            </div>
          </div>
        )}

        {step === scheduleStep && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div className="text-sm text-zinc-300 font-semibold">Horarios</div>
              {loadingBusy ? (
                <div className="text-xs text-zinc-400">
                  Actualizando disponibilidad...
                </div>
              ) : null}
            </div>

            {slots.length === 0 ? (
              <div className="rounded-2xl bg-zinc-950/40 ring-1 ring-white/10 p-4 text-sm text-zinc-400">
                Ese día no hay disponibilidad para este barbero.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {slots.map((s) => {
                  const selected =
                    slot?.start?.toISOString?.() === s.start.toISOString();
                  const busy = s.status !== "free";
                  const isPast = s.start.getTime() < Date.now();
                  const disabled = busy || isPast || loadingBusy || loadingHold || loadingConfirm;

                  return (
                    <button
                      key={s.start.toISOString()}
                      disabled={disabled}
                      onClick={() => pickSlot(s)}
                      className={[
                        "rounded-xl px-3 py-3 text-sm font-semibold ring-1 transition",
                        selected
                          ? "bg-amber-400 text-zinc-950 ring-amber-300"
                          : disabled
                          ? "bg-red-500/10 text-red-200 ring-red-500/30 cursor-not-allowed"
                          : "bg-zinc-950/40 ring-white/10 hover:ring-white/20",
                        loadingHold ? "opacity-60 cursor-wait" : "",
                      ].join(" ")}
                      title={
                        busy
                          ? "Ocupado"
                          : isPast
                          ? "Horario pasado"
                          : loadingBusy
                          ? "Cargando disponibilidad..."
                          : loadingHold
                          ? "Reservando..."
                          : ""
                      }
                    >
                      {formatTime(s.start)}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="rounded-2xl bg-zinc-950/40 ring-1 ring-white/10 p-4 space-y-4">
              <div className="text-sm font-semibold text-zinc-300">
                Datos para la reserva
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Nombre y apellido *
                  </label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Ej: Juan Pérez"
                    className="w-full rounded-xl bg-zinc-900 px-3 py-2 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    WhatsApp (obligatorio) *
                  </label>

                  <input
                    type="tel"
                    inputMode="numeric"
                    value={customerPhone}
                    onChange={(e) => {
                      const digits = onlyDigits(e.target.value);
                      setCustomerPhone(digits);

                      if (!digits)
                        setPhoneError("El teléfono es obligatorio.");
                      else if (!isValidArPhone(digits))
                        setPhoneError(
                          "Formato inválido. Ejemplo: 3813686226 (10 dígitos)."
                        );
                      else setPhoneError("");
                    }}
                    placeholder="Ej: 3813686226"
                    className="w-full rounded-xl bg-zinc-900 px-3 py-2 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />

                  {phoneError && (
                    <p className="mt-1 text-xs text-red-300">{phoneError}</p>
                  )}
                </div>
              </div>

              {!slot && (
                <p className="text-xs text-zinc-400">
                  Seleccioná un horario libre para habilitar la confirmación.
                </p>
              )}

              {slot && !holdToken && (
                <p className="text-xs text-amber-300">Reservando el horario...</p>
              )}

              {slot && holdToken && !phoneValid && (
                <p className="text-xs text-amber-400">
                  Ingresá tu WhatsApp (10 dígitos) para confirmar.
                </p>
              )}

              {bookingPaymentRequired && slot && holdToken && (
                <p className="text-xs text-amber-300">
                  Al confirmar, serás redirigido a Mercado Pago para abonar el total del servicio.
                </p>
              )}

              {slot && holdToken && (
                <p className="text-xs text-zinc-400">
                  Horario seleccionado:{" "}
                  <span className="text-zinc-200 font-semibold">
                    {formatTime(slot.start)}
                  </span>{" "}
                  ({barber?.name || `Barbero ${barberId}`} ·{" "}
                  {service?.name || "Servicio"})
                </p>
              )}
            </div>

            {errorMsg && (
              <div className="rounded-xl bg-red-500/10 ring-1 ring-red-500/30 px-3 py-2 text-sm text-red-200">
                {errorMsg}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}


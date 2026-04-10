import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { formatTime, parseMySQLDateTimeLocal } from "../../lib/time";
import { maskNameOptional } from "./display.utils";

function toDateParam(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function statusPill(status) {
  const base =
    "inline-flex items-center rounded-full px-5 py-2 text-2xl font-black ring-1";
  switch (status) {
    case "in_progress":
      return `${base} bg-amber-400 text-zinc-950 ring-amber-300`;
    case "pending":
      return `${base} bg-zinc-200 text-zinc-950 ring-white/30`;
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

function mapApiAppointment(r) {
  // DATETIME MySQL (sin timezone) -> lo parseamos como local (para que coincida con los slots)
  const start = parseMySQLDateTimeLocal(r.start_at);
  const end = parseMySQLDateTimeLocal(r.end_at);

  return {
    id: String(r.id),
    barberId: r.barber_id,
    serviceId: r.service_id,
    customerName: r.customer_name,
    customerPhone: r.customer_phone || "",
    startAt: start,
    endAt: end,
    status: r.status,
    notes: r.notes || "",
  };
}

function msToMMSS(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export default function DisplayPages({
  barbers = [],
  branches = [],
  services = [],
  loadingCatalog = false,
  catalogError = "",
  brandName = "",
}) {
  const [now, setNow] = useState(() => new Date());
  const [appointments, setAppointments] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const displayBrandName = String(brandName || "").trim() || "Tu Estilo - Barbería";
  const displayBranchId = useMemo(() => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("branchId");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, []);
  const displayBranchName = useMemo(() => {
    if (!displayBranchId) return "";
    const row = branches.find((b) => Number(b.id) === Number(displayBranchId));
    return String(row?.name || "").trim();
  }, [branches, displayBranchId]);
  const visibleBarbers = useMemo(() => {
    if (!displayBranchId) return barbers;
    return barbers.filter((b) => Number(b.branchId) === Number(displayBranchId));
  }, [barbers, displayBranchId]);

  const serviceById = useMemo(() => {
    const m = new Map();
    services.forEach((s) => m.set(s.id, s));
    return m;
  }, [services]);

  // Reloj en vivo
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  async function loadAppointments() {
    setErr("");
    setLoading(true);
    try {
      const dateStr = toDateParam(new Date());
      const branchQuery = displayBranchId ? `&branchId=${displayBranchId}` : "";
      const rows = await apiFetch(`/appointments/display?date=${dateStr}${branchQuery}`);
      setAppointments(rows.map(mapApiAppointment));
    } catch (e) {
      setErr(e.message || "Error cargando turnos");
    } finally {
      setLoading(false);
    }
  }

  // Auto refresh (TV)
  useEffect(() => {
    loadAppointments();
    const t = setInterval(loadAppointments, 10000); // cada 10s
    return () => clearInterval(t);
  }, [displayBranchId]);

  // Agrupar por barbero
  const apptsByBarber = useMemo(() => {
    const m = new Map();
    for (const b of barbers) m.set(b.id, []);
    for (const a of appointments) m.get(a.barberId)?.push(a);

    for (const [k, arr] of m.entries()) {
      arr.sort((x, y) => x.startAt.getTime() - y.startAt.getTime());
      m.set(k, arr);
    }
    return m;
  }, [appointments, visibleBarbers]);

  function getInProgress(list) {
    return list.find((a) => a.status === "in_progress");
  }
  function getNext(list) {
    return list
      .filter((a) => a.status === "pending")
      .filter((a) => a.startAt.getTime() >= now.getTime() - 5 * 60 * 1000)
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];
  }
  function getAfterNext(list, nextId) {
    return list
      .filter((a) => a.status === "pending")
      .filter((a) => a.id !== nextId)
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* HEADER gigante */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto w-full max-w-[1600px] px-8 py-6 flex items-center justify-between">
          <div>
            <div className="text-5xl font-black tracking-tight">
              Turnos en vivo
            </div>
            <div className="mt-2 text-2xl text-zinc-400">
              {displayBrandName}
              {displayBranchName ? ` · ${displayBranchName}` : ""}
              {" · "}
              {now.toLocaleDateString("es-AR")}
            </div>
          </div>

          <div className="text-right">
            <div className="text-7xl font-black tabular-nums">
              {formatTime(now)}
            </div>
            <div className="mt-2 text-xl text-zinc-400">
              Actualiza automáticamente
            </div>
          </div>
        </div>
      </header>

      {/* BODY centrado y grande */}
      <main className="mx-auto w-full max-w-[1600px] px-8 py-10">
        {loadingCatalog && !barbers.length ? (
          <div className="mb-8 rounded-2xl bg-zinc-900/40 ring-1 ring-white/10 px-6 py-4 text-2xl text-zinc-400">
            Cargando barberos y servicios...
          </div>
        ) : null}

        {catalogError ? (
          <div className="mb-8 rounded-2xl bg-red-500/10 ring-1 ring-red-500/30 px-6 py-4 text-2xl text-red-200">
            {catalogError}
          </div>
        ) : null}

        {err && (
          <div className="mb-8 rounded-2xl bg-red-500/10 ring-1 ring-red-500/30 px-6 py-4 text-2xl text-red-200">
            {err}
          </div>
        )}

        {loading && !appointments.length ? (
          <div className="text-3xl text-zinc-400">Cargando turnos...</div>
        ) : null}
        {!loading && !visibleBarbers.length ? (
          <div className="text-2xl text-zinc-400">
            No hay barberos activos para la sucursal seleccionada.
          </div>
        ) : null}

        <div
          className={[
            "grid gap-8",
            visibleBarbers.length === 1
              ? "grid-cols-1"
              : visibleBarbers.length === 2
              ? "grid-cols-2"
              : "grid-cols-3",
          ].join(" ")}
        >
          {visibleBarbers.map((b) => {
            const list = apptsByBarber.get(b.id) || [];
            const inProg = getInProgress(list);
            const next = getNext(list);
            const after = getAfterNext(list, next?.id);

            const remaining = inProg
              ? inProg.endAt.getTime() - now.getTime()
              : null;

            return (
              <section
                key={b.id}
                className="rounded-[28px] bg-zinc-900/40 ring-1 ring-white/10 overflow-hidden"
              >
                {/* Barber title */}
                <div className="p-8 border-b border-white/10 flex items-center justify-between">
                  <div>
                    <div className="text-4xl font-black">{b.name}</div>
                    <div className="mt-2 text-2xl text-zinc-400">{b.role}</div>
                  </div>

                  {inProg ? (
                    <div className={statusPill("in_progress")}>
                      EN CURSO · {msToMMSS(remaining ?? 0)}
                    </div>
                  ) : next ? (
                    <div className={statusPill("pending")}>
                      PRÓXIMO · {formatTime(next.startAt)}
                    </div>
                  ) : (
                    <div className={statusPill("done")}>SIN PENDIENTES</div>
                  )}
                </div>

                {/* Big cards */}
                <div className="p-8 space-y-6">
                  {/* EN CURSO */}
                  <div className="rounded-[24px] bg-zinc-950/40 ring-1 ring-white/10 p-7">
                    <div className="flex items-center justify-between gap-6">
                      <div className="text-3xl font-black text-zinc-200">
                        En curso
                      </div>
                      {inProg ? (
                        <div className="text-5xl font-black tabular-nums">
                          {msToMMSS(remaining ?? 0)}
                        </div>
                      ) : (
                        <div className="text-3xl text-zinc-500">—</div>
                      )}
                    </div>

                    {inProg ? (
                      <div className="mt-4">
                        <div className="text-5xl font-black">
                          {maskNameOptional(inProg.customerName)}
                        </div>
                        <div className="mt-2 text-2xl text-zinc-400">
                          {formatTime(inProg.startAt)} - {formatTime(inProg.endAt)} ·{" "}
                          {serviceById.get(inProg.serviceId)?.name ?? "Servicio"}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 text-3xl text-zinc-500">
                        No hay turno en curso
                      </div>
                    )}
                  </div>

                  {/* PRÓXIMO */}
                  <div className="rounded-[24px] bg-zinc-950/30 ring-1 ring-white/10 p-7">
                    <div className="text-3xl font-black text-zinc-200">
                      Próximo
                    </div>
                    {next ? (
                      <div className="mt-4 flex items-end justify-between gap-6">
                        <div>
                          <div className="text-5xl font-black">
                            {maskNameOptional(next.customerName)}
                          </div>
                          <div className="mt-2 text-2xl text-zinc-400">
                            {serviceById.get(next.serviceId)?.name ?? "Servicio"}
                          </div>
                        </div>
                        <div className="text-6xl font-black tabular-nums">
                          {formatTime(next.startAt)}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 text-3xl text-zinc-500">
                        No hay próximos turnos
                      </div>
                    )}
                  </div>

                  {/* LUEGO */}
                  <div className="rounded-[24px] bg-zinc-950/20 ring-1 ring-white/10 p-7">
                    <div className="text-3xl font-black text-zinc-200">
                      Luego
                    </div>
                    {after ? (
                      <div className="mt-4 flex items-end justify-between gap-6">
                        <div className="text-4xl font-black">
                          {maskNameOptional(after.customerName)}
                        </div>
                        <div className="text-5xl font-black tabular-nums">
                          {formatTime(after.startAt)}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 text-3xl text-zinc-500">—</div>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        <div className="mt-10 text-center text-xl text-zinc-500">
          
        </div>
      </main>
    </div>
  );
}

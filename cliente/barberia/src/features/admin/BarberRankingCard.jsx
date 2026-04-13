import { Fragment, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";

function monthLabel(m) {
  const labels = [
    "Enero","Febrero","Marzo","Abril","Mayo","Junio",
    "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
  ];
  return labels[m - 1] || `Mes ${m}`;
}

export default function BarberRankingCard() {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [ranking, setRanking] = useState([]);
  const [clientsByBarber, setClientsByBarber] = useState({});
  const [servicesByBarber, setServicesByBarber] = useState({});
  const [summary, setSummary] = useState({ cuts: 0, revenue_ars: 0, commission_ars: 0 });
  const [history, setHistory] = useState([]);
  const [topClients, setTopClients] = useState([]);

  // expand/collapse por barbero
  const [openBarber, setOpenBarber] = useState(null);

  const years = useMemo(() => {
    return [currentYear - 1, currentYear, currentYear + 1];
  }, [currentYear]);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");

      try {
        const data = await apiFetch(
          `/appointments/ranking?year=${year}&month=${month}`
        );

        const list = Array.isArray(data?.ranking) ? data.ranking : [];
        if (alive) {
          setRanking(list);
          setClientsByBarber(data?.clientsByBarber || {});
          setServicesByBarber(data?.servicesByBarber || {});
          setSummary({
            cuts: Number(data?.summary?.cuts || 0),
            revenue_ars: Number(data?.summary?.revenue_ars || 0),
            commission_ars: Number(data?.summary?.commission_ars || 0),
          });
          setHistory(Array.isArray(data?.history) ? data.history : []);
          setTopClients(Array.isArray(data?.topClients) ? data.topClients : []);
          setOpenBarber(null);
        }
      } catch (e) {
        if (alive) {
          setRanking([]);
          setClientsByBarber({});
          setServicesByBarber({});
          setSummary({ cuts: 0, revenue_ars: 0, commission_ars: 0 });
          setHistory([]);
          setTopClients([]);
          setOpenBarber(null);
          setErrorMsg(e?.message || "No se pudo cargar el ranking.");
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [year, month]);

  return (
    <div className="rounded-2xl bg-zinc-950/40 ring-1 ring-white/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-zinc-200">
            Ranking mensual (cortes finalizados)
          </div>
          <div className="text-xs text-zinc-400">
            Se cuentan solo los turnos finalizados. Incluye clientes que asistieron.
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-xl bg-zinc-900 px-3 py-2 text-sm ring-1 ring-white/10"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>

          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-xl bg-zinc-900 px-3 py-2 text-sm ring-1 ring-white/10"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-zinc-900/60 px-3 py-2 ring-1 ring-white/10">
          <div className="text-xs text-zinc-400">Servicios finalizados</div>
          <div className="mt-1 text-lg font-bold text-zinc-100">{summary.cuts}</div>
        </div>
        <div className="rounded-xl bg-zinc-900/60 px-3 py-2 ring-1 ring-white/10">
          <div className="text-xs text-zinc-400">Facturación estimada</div>
          <div className="mt-1 text-lg font-bold text-emerald-300">
            {new Intl.NumberFormat("es-AR", {
              style: "currency",
              currency: "ARS",
              maximumFractionDigits: 0,
            }).format(summary.revenue_ars)}
          </div>
        </div>
        <div className="rounded-xl bg-zinc-900/60 px-3 py-2 ring-1 ring-white/10">
          <div className="text-xs text-zinc-400">Ticket promedio</div>
          <div className="mt-1 text-lg font-bold text-amber-300">
            {new Intl.NumberFormat("es-AR", {
              style: "currency",
              currency: "ARS",
              maximumFractionDigits: 0,
            }).format(summary.cuts > 0 ? summary.revenue_ars / summary.cuts : 0)}
          </div>
        </div>
        <div className="rounded-xl bg-zinc-900/60 px-3 py-2 ring-1 ring-white/10">
          <div className="text-xs text-zinc-400">Comisión total estimada</div>
          <div className="mt-1 text-lg font-bold text-cyan-300">
            {new Intl.NumberFormat("es-AR", {
              style: "currency",
              currency: "ARS",
              maximumFractionDigits: 0,
            }).format(summary.commission_ars)}
          </div>
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="text-sm text-zinc-400">Cargando ranking...</div>
        ) : errorMsg ? (
          <div className="rounded-xl bg-red-500/10 ring-1 ring-red-500/30 px-3 py-2 text-sm text-red-200">
            {errorMsg}
          </div>
        ) : ranking.length === 0 ? (
          <div className="text-sm text-zinc-400">
            No hay cortes finalizados en este mes.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl ring-1 ring-white/10">
            <table className="min-w-[640px] w-full text-sm">
              <thead className="bg-white/5 text-zinc-300">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Barbero</th>
                  <th className="px-3 py-2 text-right">Cortes</th>
                  <th className="px-3 py-2 text-right">Facturación</th>
                  <th className="px-3 py-2 text-right">Comisión</th>
                  <th className="px-3 py-2 text-right">Detalle</th>
                </tr>
              </thead>

              <tbody>
                {ranking.map((r, idx) => {
                  const id = String(r.barber_id);
                  const open = openBarber === id;
                  const clients = Array.isArray(clientsByBarber?.[id])
                    ? clientsByBarber[id]
                    : [];
                  const services = Array.isArray(servicesByBarber?.[id])
                    ? servicesByBarber[id]
                    : [];

                  return (
                    <Fragment key={id}>
                      <tr className="border-t border-white/10">
                        <td className="px-3 py-2 text-zinc-400">{idx + 1}</td>
                        <td className="px-3 py-2 text-zinc-200">{r.barber_name}</td>
                        <td className="px-3 py-2 text-right font-semibold text-amber-300">
                          {r.cuts}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-300">
                          {new Intl.NumberFormat("es-AR", {
                            style: "currency",
                            currency: "ARS",
                            maximumFractionDigits: 0,
                          }).format(Number(r.revenue_ars || 0))}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-cyan-300">
                          {new Intl.NumberFormat("es-AR", {
                            style: "currency",
                            currency: "ARS",
                            maximumFractionDigits: 0,
                          }).format(Number(r.commission_ars || 0))}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => setOpenBarber(open ? null : id)}
                            className="rounded-xl px-3 py-1.5 text-xs font-semibold hover:bg-white/10"
                          >
                            {open ? "Ocultar clientes" : "Ver clientes"}
                          </button>
                        </td>
                      </tr>

                      {open ? (
                        <tr className="border-t border-white/10">
                          <td colSpan={6} className="px-3 py-3 bg-zinc-950/30">
                            <div className="grid gap-3 lg:grid-cols-2">
                              <div>
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                                  Clientes atendidos
                                </div>
                                {clients.length === 0 ? (
                                  <div className="text-sm text-zinc-400">
                                    No hay clientes finalizados para este barbero en el mes.
                                  </div>
                                ) : (
                                  <div className="overflow-x-auto rounded-xl ring-1 ring-white/10">
                                    <table className="min-w-[420px] w-full text-sm">
                                      <thead className="bg-white/5 text-zinc-300">
                                        <tr>
                                          <th className="px-3 py-2 text-left">Cliente</th>
                                          <th className="px-3 py-2 text-left">Teléfono</th>
                                          <th className="px-3 py-2 text-right">Veces</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {clients.map((c) => (
                                          <tr
                                            key={`${id}-${c.customer_phone}`}
                                            className="border-t border-white/10"
                                          >
                                            <td className="px-3 py-2 text-zinc-200">{c.customer_name}</td>
                                            <td className="px-3 py-2 text-zinc-400">{c.customer_phone}</td>
                                            <td className="px-3 py-2 text-right font-semibold text-amber-300">
                                              {c.visits}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>

                              <div>
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                                  Servicios realizados
                                </div>
                                {services.length === 0 ? (
                                  <div className="text-sm text-zinc-400">
                                    No hay servicios finalizados para este barbero en el mes.
                                  </div>
                                ) : (
                                  <div className="overflow-x-auto rounded-xl ring-1 ring-white/10">
                                    <table className="min-w-[420px] w-full text-sm">
                                      <thead className="bg-white/5 text-zinc-300">
                                        <tr>
                                          <th className="px-3 py-2 text-left">Servicio</th>
                                          <th className="px-3 py-2 text-right">Cantidad</th>
                                          <th className="px-3 py-2 text-right">Facturación</th>
                                          <th className="px-3 py-2 text-right">Comisión</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {services.map((s) => (
                                          <tr
                                            key={`${id}-svc-${s.service_id}`}
                                            className="border-t border-white/10"
                                          >
                                            <td className="px-3 py-2 text-zinc-200">{s.service_name}</td>
                                            <td className="px-3 py-2 text-right font-semibold text-amber-300">
                                              {s.qty}
                                            </td>
                                            <td className="px-3 py-2 text-right font-semibold text-emerald-300">
                                              {new Intl.NumberFormat("es-AR", {
                                                style: "currency",
                                                currency: "ARS",
                                                maximumFractionDigits: 0,
                                              }).format(Number(s.revenue_ars || 0))}
                                            </td>
                                            <td className="px-3 py-2 text-right font-semibold text-cyan-300">
                                              {new Intl.NumberFormat("es-AR", {
                                                style: "currency",
                                                currency: "ARS",
                                                maximumFractionDigits: 0,
                                              }).format(Number(s.commission_ars || 0))}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-5 rounded-xl bg-zinc-900/45 p-3 ring-1 ring-white/10">
        <div className="mb-2 text-sm font-semibold text-zinc-200">Top clientes del mes</div>
        {topClients.length === 0 ? (
          <div className="text-sm text-zinc-400">Sin clientes finalizados este mes.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl ring-1 ring-white/10">
            <table className="min-w-[560px] w-full text-sm">
              <thead className="bg-white/5 text-zinc-300">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">Teléfono</th>
                  <th className="px-3 py-2 text-right">Visitas</th>
                  <th className="px-3 py-2 text-right">Total gastado</th>
                </tr>
              </thead>
              <tbody>
                {topClients.map((c, idx) => (
                  <tr key={`top-${c.customer_phone}-${idx}`} className="border-t border-white/10">
                    <td className="px-3 py-2 text-zinc-400">{idx + 1}</td>
                    <td className="px-3 py-2 text-zinc-200">{c.customer_name}</td>
                    <td className="px-3 py-2 text-zinc-400">{c.customer_phone}</td>
                    <td className="px-3 py-2 text-right font-semibold text-amber-300">{c.visits}</td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-300">
                      {new Intl.NumberFormat("es-AR", {
                        style: "currency",
                        currency: "ARS",
                        maximumFractionDigits: 0,
                      }).format(Number(c.spent_ars || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-5 rounded-xl bg-zinc-900/45 p-3 ring-1 ring-white/10">
        <div className="mb-2 text-sm font-semibold text-zinc-200">Historial últimos 6 meses</div>
        {history.length === 0 ? (
          <div className="text-sm text-zinc-400">Sin historial disponible.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl ring-1 ring-white/10">
            <table className="min-w-[520px] w-full text-sm">
              <thead className="bg-white/5 text-zinc-300">
                <tr>
                  <th className="px-3 py-2 text-left">Mes</th>
                  <th className="px-3 py-2 text-right">Servicios finalizados</th>
                  <th className="px-3 py-2 text-right">Facturación</th>
                  <th className="px-3 py-2 text-right">Comisión</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={`${h.year}-${h.month}`} className="border-t border-white/10">
                    <td className="px-3 py-2 text-zinc-200">
                      {monthLabel(Number(h.month))} {h.year}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-amber-300">
                      {Number(h.cuts || 0)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-300">
                      {new Intl.NumberFormat("es-AR", {
                        style: "currency",
                        currency: "ARS",
                        maximumFractionDigits: 0,
                      }).format(Number(h.revenue_ars || 0))}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-cyan-300">
                      {new Intl.NumberFormat("es-AR", {
                        style: "currency",
                        currency: "ARS",
                        maximumFractionDigits: 0,
                      }).format(Number(h.commission_ars || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

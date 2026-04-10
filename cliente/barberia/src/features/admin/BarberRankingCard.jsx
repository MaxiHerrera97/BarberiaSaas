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
          setOpenBarber(null);
        }
      } catch (e) {
        if (alive) {
          setRanking([]);
          setClientsByBarber({});
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
            Se cuenta <span className="text-zinc-200">solo status = done</span>. Incluye clientes que asistieron.
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

                  return (
                    <Fragment key={id}>
                      <tr className="border-t border-white/10">
                        <td className="px-3 py-2 text-zinc-400">{idx + 1}</td>
                        <td className="px-3 py-2 text-zinc-200">{r.barber_name}</td>
                        <td className="px-3 py-2 text-right font-semibold text-amber-300">
                          {r.cuts}
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
                          <td colSpan={4} className="px-3 py-3 bg-zinc-950/30">
                            {clients.length === 0 ? (
                              <div className="text-sm text-zinc-400">
                                No hay clientes finalizados para este barbero en el mes.
                              </div>
                            ) : (
                              <div className="overflow-x-auto rounded-xl ring-1 ring-white/10">
                                <table className="min-w-[560px] w-full text-sm">
                                  <thead className="bg-white/5 text-zinc-300">
                                    <tr>
                                      <th className="px-3 py-2 text-left">Cliente</th>
                                      <th className="px-3 py-2 text-left">Teléfono</th>
                                      <th className="px-3 py-2 text-right">Veces (done)</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {clients.map((c) => (
                                      <tr
                                        key={`${id}-${c.customer_phone}`}
                                        className="border-t border-white/10"
                                      >
                                        <td className="px-3 py-2 text-zinc-200">
                                          {c.customer_name}
                                        </td>
                                        <td className="px-3 py-2 text-zinc-400">
                                          {c.customer_phone}
                                        </td>
                                        <td className="px-3 py-2 text-right font-semibold text-amber-300">
                                          {c.visits}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
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
    </div>
  );
}

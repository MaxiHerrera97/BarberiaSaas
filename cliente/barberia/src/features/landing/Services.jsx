import Container from "../../components/Container";

function moneyARS(n) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function Services({ items }) {
  return (
    <section
      id="servicios"
      className="py-20 bg-[linear-gradient(180deg,rgba(8,11,16,0)_0%,rgba(8,11,16,0.55)_40%,rgba(8,11,16,0.9)_100%)]"
    >
      <Container>
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold tracking-[0.12em] text-[var(--brand-soft)] uppercase">Catalogo</p>
            <h2 className="heading-display mt-2 text-4xl sm:text-5xl">Servicios y precios</h2>
            <p className="mt-3 text-zinc-300/80">
              Elegí el servicio y reservá en pocos pasos.
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {items.map((s) => (
            <div
              key={s.id}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(140deg,rgba(20,24,32,0.95),rgba(14,17,23,0.8))] p-5 shadow-[0_10px_30px_rgba(0,0,0,0.26)] transition hover:-translate-y-0.5 hover:border-[var(--brand-soft)]/35"
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(217,161,61,0.7),transparent)] opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-lg font-bold text-zinc-100">{s.name}</div>
                  <div className="mt-1 text-sm text-zinc-400">
                    Duración: {s.durationMin} min
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--brand)]/30 bg-[var(--brand)]/10 px-3 py-1 text-lg font-black text-[var(--brand-soft)] sm:text-right">
                  {moneyARS(s.price)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

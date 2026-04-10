import { useEffect, useMemo, useState } from "react";
import Container from "../../components/Container";
import Button from "../../ui/Button";

export default function HeroSlider({ slides, onOpenBooking, brandName = "Tu Estilo - Barberia" }) {
  const [idx, setIdx] = useState(0);
  const count = slides.length;

  const current = useMemo(() => slides[idx], [slides, idx]);

  useEffect(() => {
    const t = setInterval(() => setIdx((p) => (p + 1) % count), 5000);
    return () => clearInterval(t);
  }, [count]);

  return (
    <section id="inicio" className="relative">
      <div className="relative h-[62vh] min-h-[520px] sm:min-h-[460px] md:h-[72vh] md:min-h-[520px] w-full overflow-hidden">
        <img
          src={current.src}
          alt={current.title}
          className="h-full w-full object-cover opacity-85 scale-[1.02] transition-transform duration-700"
          onError={(e) => {
            e.currentTarget.src = "/hero/hero1.jpg"; // fallback local
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_8%_22%,rgba(217,161,61,0.28),transparent_36%),linear-gradient(120deg,rgba(4,6,10,0.78)_0%,rgba(4,6,10,0.48)_45%,rgba(4,6,10,0.82)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.06)_0%,rgba(0,0,0,0.54)_70%,rgba(0,0,0,0.82)_100%)]" />

        <Container className="absolute inset-0 flex items-end pb-10 sm:pb-12">
          <div className="max-w-2xl p-1 sm:p-2 anim-fade-rise">
            <p className="inline-flex rounded-full border border-[var(--brand-soft)]/45 bg-black/20 px-3 py-1 text-[11px] font-bold tracking-[0.1em] text-[var(--brand-soft)] uppercase">
              {brandName}
            </p>
            <h1 className="heading-display mt-2 text-5xl sm:text-6xl md:text-8xl leading-[0.95]">
              {current.title}
            </h1>
            <p className="mt-4 max-w-xl text-zinc-100/90 text-base md:text-lg">
              {current.subtitle}
            </p>

            <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <Button onClick={onOpenBooking} className="w-full sm:w-auto">
                Sacar turno
              </Button>
              <a
                href="#servicios"
                className="rounded-xl border border-white/25 bg-black/25 px-4 py-2 text-center text-sm font-semibold text-zinc-100 hover:border-[var(--brand-soft)] hover:text-[var(--brand-soft)] transition-colors"
              >
                Ver servicios
              </a>
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              {slides.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIdx(i)}
                  className={[
                    "h-2.5 w-10 rounded-full transition-all",
                    i === idx ? "bg-[var(--brand)]" : "bg-white/20 hover:bg-white/35",
                  ].join(" ")}
                  aria-label={`Ir al slide ${i + 1}`}
                />
              ))}
            </div>
          </div>
        </Container>
      </div>
    </section>
  );
}

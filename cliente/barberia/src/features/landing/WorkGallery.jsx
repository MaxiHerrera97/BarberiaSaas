import { useCallback, useEffect, useMemo, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Container from "../../components/Container";
import Button from "../../ui/Button";
import Lightbox from "../../ui/Lightbox";

export default function WorkGallery({ photos, onOpenBooking }) {
  // Embla: loop + drag
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    align: "start",
    containScroll: "trimSnaps",
  });

  const [selectedIndex, setSelectedIndex] = useState(0);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const slides = useMemo(() => photos ?? [], [photos]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi, onSelect]);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);
  const scrollTo = useCallback((i) => emblaApi?.scrollTo(i), [emblaApi]);

  function openLightbox(i) {
    setLightboxIndex(i);
    setLightboxOpen(true);
  }

  function closeLightbox() {
    setLightboxOpen(false);
  }

  function lightPrev() {
    setLightboxIndex((p) => (p - 1 + slides.length) % slides.length);
  }

  function lightNext() {
    setLightboxIndex((p) => (p + 1) % slides.length);
  }

  return (
    <section
      id="trabajos"
      className="py-20 bg-[radial-gradient(circle_at_70%_20%,rgba(217,161,61,0.1),transparent_36%),linear-gradient(180deg,rgba(8,11,16,0.88)_0%,rgba(8,11,16,1)_100%)]"
    >
      <Container>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <p className="text-xs font-bold tracking-[0.12em] text-[var(--brand-soft)] uppercase">Portafolio</p>
            <h2 className="heading-display mt-2 text-4xl sm:text-5xl">Trabajos realizados</h2>
            <p className="mt-3 text-zinc-300/80">
              Deslizá para ver más. Tocá una foto para ampliar.
            </p>
          </div>
          <Button onClick={onOpenBooking} className="w-full sm:w-auto">
            Sacar turno
          </Button>
        </div>

        <div className="mt-10 rounded-3xl border border-white/10 bg-[linear-gradient(140deg,rgba(20,24,32,0.9),rgba(10,13,19,0.82))] p-4 shadow-[0_16px_44px_rgba(0,0,0,0.32)] sm:p-5">
          {/* Controles */}
          <div className="mb-4 grid grid-cols-[auto_1fr_auto] items-center gap-3">
            <button
              onClick={scrollPrev}
              className="rounded-xl border border-white/15 px-3 py-2 hover:bg-white/10"
              aria-label="Anterior"
            >
              ←
            </button>

            <div className="text-center text-xs text-zinc-400">
              Deslizá con el dedo / mouse
            </div>

            <button
              onClick={scrollNext}
              className="rounded-xl border border-white/15 px-3 py-2 hover:bg-white/10"
              aria-label="Siguiente"
            >
              →
            </button>
          </div>

          {/* Embla viewport */}
          <div className="overflow-hidden" ref={emblaRef}>
            <div className="-ml-4 flex">
              {slides.map((src, i) => (
                <div
                  key={src}
                  className="pl-4 flex-[0_0_88%] sm:flex-[0_0_60%] md:flex-[0_0_33%]"
                >
                  <button
                    onClick={() => openLightbox(i)}
                    className="
                      w-full rounded-2xl overflow-hidden
                      border border-white/10 bg-zinc-950 text-left
                      hover:border-[var(--brand-soft)]/45 transition
                    "
                    aria-label={`Abrir imagen ${i + 1}`}
                  >
                    <img
                      src={src}
                      alt="Trabajo"
                      className="h-65 sm:h-69 md:h-88 w-full object-cover object-top"
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="px-4 py-2.5">
                      <div className="text-sm font-semibold text-zinc-100">Corte y Estilo</div>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>
          {/* Dots */}
          <div className="mt-4 flex justify-center gap-2">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => scrollTo(i)}
                className={[
                  "h-2 w-2 rounded-full transition",
                  i === selectedIndex
                    ? "bg-[var(--brand)]"
                    : "bg-white/20 hover:bg-white/30",
                ].join(" ")}
                aria-label={`Ir a ${i + 1}`}
              />
            ))}
          </div>
        </div>
      </Container>

      {/* Lightbox */}
      <Lightbox
        open={lightboxOpen}
        onClose={closeLightbox}
        images={slides}
        index={lightboxIndex}
        onPrev={lightPrev}
        onNext={lightNext}
      />
    </section>
  );
}

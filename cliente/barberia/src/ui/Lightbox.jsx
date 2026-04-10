import { useEffect } from "react";

export default function Lightbox({ open, onClose, images, index, onPrev, onNext }) {
  useEffect(() => {
    function onKeyDown(e) {
      if (!open) return;
      if (e.key === "Escape") onClose?.();
      if (e.key === "ArrowLeft") onPrev?.();
      if (e.key === "ArrowRight") onNext?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, onPrev, onNext]);

  if (!open) return null;

  const src = images?.[index];

  return (
    <div className="fixed inset-0 z-[60]">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/90"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* content */}
      <div className="relative z-[61] flex h-full w-full items-center justify-center p-4">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-xl px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/10"
          aria-label="Cerrar"
        >
          ✕
        </button>

        <button
          onClick={onPrev}
          className="absolute left-4 md:left-8 rounded-2xl px-4 py-3 text-xl text-zinc-200 hover:bg-white/10"
          aria-label="Anterior"
        >
          ←
        </button>

        <div className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-2xl ring-1 ring-white/10 bg-zinc-950">
          <img
            src={src}
            alt="Trabajo ampliado"
            className="max-h-[88vh] w-full object-contain"
            draggable={false}
          />
        </div>

        <button
          onClick={onNext}
          className="absolute right-4 md:right-8 rounded-2xl px-4 py-3 text-xl text-zinc-200 hover:bg-white/10"
          aria-label="Siguiente"
        >
          →
        </button>

        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-zinc-300">
          {index + 1} / {images.length}
        </div>
      </div>
    </div>
  );
}

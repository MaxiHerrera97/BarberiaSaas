/*import { useEffect } from "react";

export default function Modal({ open, onClose, title, children, footer }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      { overlay }
      <button
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />

      {moda}
      <div className="relative z-10 mx-auto flex min-h-screen items-center justify-center p-4">
        <div
          className="
            w-full max-w-3xl
            rounded-3xl bg-zinc-950 text-zinc-100
            ring-1 ring-white/10 shadow-2xl
            overflow-hidden
          "
          style={{ maxHeight: "85vh" }}
        >
          { header fijo }
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
            <div className="text-lg font-black">{title}</div>
            <button
              onClick={onClose}
              className="rounded-xl px-3 py-2 text-sm font-semibold hover:bg-white/10"
            >
              Cerrar
            </button>
          </div>

          { body scrolleable }
          <div className="px-6 py-5 overflow-y-auto" style={{ maxHeight: "calc(85vh - 64px)" }}>
            {children}
          </div>

          { footer opcional fijo }
          {footer ? (
            <div className="border-t border-white/10 px-6 py-4">{footer}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}*/

import { useEffect } from "react";

export default function Modal({ open, onClose, title, children, footer }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* overlay */}
      <button
        aria-label="Cerrar"
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />

      {/* dialog wrapper */}
      <div className="absolute inset-0 flex items-end justify-center p-2 sm:items-center sm:p-4">
        {/* dialog */}
        <div
          role="dialog"
          aria-modal="true"
          className="
            w-full max-w-2xl
            rounded-t-2xl rounded-b-none sm:rounded-2xl
            bg-zinc-950 text-zinc-100
            ring-1 ring-white/10
            shadow-2xl
            flex flex-col
            max-h-[92vh] sm:max-h-[90vh]
          "
          onClick={(e) => e.stopPropagation()} // evita cerrar al clickear adentro
        >
          {/* header */}
          <div className="border-b border-white/10 px-4 py-4 sm:px-6 shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base sm:text-lg font-black">{title}</h2>
              <button
                onClick={onClose}
                className="rounded-xl px-3 py-1.5 text-sm font-semibold hover:bg-white/10"
              >
                Cerrar
              </button>
            </div>
          </div>

          {/* body (SCROLL INTERNO) */}
          <div className="px-4 py-4 overflow-y-auto sm:px-6 sm:py-5">
            {children}
            {/* padding extra para que el último contenido no quede pegado al footer */}
            <div className="h-2" />
          </div>

          {/* footer (SIEMPRE VISIBLE) */}
          {footer ? (
            <div className="shrink-0 border-t border-white/10 bg-zinc-950 px-4 pb-4 pt-4 sm:px-6 sm:pb-5">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import Container from "../components/Container";

function getBrandInitials(brandName) {
  const value = String(brandName || "").trim();
  if (!value) return "TB";
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
  }
  return value.slice(0, 2).toUpperCase(); //Prueba
}

export default function Navbar({
  brandName = "Tu Estilo - Barberia",
  tagline = "",
  logoUrl = "",
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const initials = getBrandInitials(brandName);
  const subtitle = String(tagline || "").trim() || "Cortes - Barba - Estilo";

  useEffect(() => {
    function onResize() {
      if (window.innerWidth >= 1024) {
        setMobileOpen(false);
      }
    }

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function closeMobileMenu() {
    setMobileOpen(false);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[rgba(217,161,61,0.18)] bg-[rgba(10,12,17,0.78)] backdrop-blur-xl">
      <Container className="py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              <div className="shrink-0">
                <img
                  src={logoUrl}
                  alt={`Logo de ${brandName}`}
                  className="h-14 w-14 object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,0.45)] sm:h-16 sm:w-16"
                />
              </div>
            ) : (
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--brand)] text-zinc-950 font-black">
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <div className="heading-display truncate text-2xl leading-tight tracking-[0.03em]">{brandName}</div>
              <div className="truncate text-xs text-[var(--text-muted)]">{subtitle}</div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <nav className="hidden items-center gap-6 text-sm text-zinc-300 lg:flex">
              <a className="transition hover:text-[var(--brand-soft)]" href="#inicio">Inicio</a>
              <a className="transition hover:text-[var(--brand-soft)]" href="#servicios">Servicios</a>
              <a className="transition hover:text-[var(--brand-soft)]" href="#trabajos">Trabajos</a>
            </nav>

            <button
              type="button"
              onClick={() => setMobileOpen((prev) => !prev)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-white/20 hover:bg-white/10 lg:hidden"
              aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
              aria-expanded={mobileOpen}
            >
              <span className="flex flex-col gap-1.5">
                <span className="block h-0.5 w-5 rounded-full bg-white" />
                <span className="block h-0.5 w-5 rounded-full bg-white" />
                <span className="block h-0.5 w-5 rounded-full bg-white" />
              </span>
            </button>
          </div>
        </div> 

        {mobileOpen ? (
          <div className="mt-4 rounded-2xl border border-white/15 bg-[rgba(19,22,30,0.9)] p-3 lg:hidden">
            <nav className="flex flex-col gap-1 text-sm text-zinc-300">
              <a
                className="rounded-xl px-3 py-2 hover:bg-white/10 hover:text-[var(--brand-soft)]"
                href="#inicio"
                onClick={closeMobileMenu}
              >
                Inicio
              </a>
              <a
                className="rounded-xl px-3 py-2 hover:bg-white/10 hover:text-[var(--brand-soft)]"
                href="#servicios"
                onClick={closeMobileMenu}
              >
                Servicios
              </a>
              <a
                className="rounded-xl px-3 py-2 hover:bg-white/10 hover:text-[var(--brand-soft)]"
                href="#trabajos"
                onClick={closeMobileMenu}
              >
                Trabajos
              </a>
            </nav>

          </div>
        ) : null}
      </Container>
    </header>
  );
}
//Hola
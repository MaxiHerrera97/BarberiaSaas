
import { useEffect, useState } from "react";
import { Routes, Route, useLocation } from "react-router-dom";

import Navbar from "./components/Navbar";
import HeroSlider from "./features/landing/HeroSlider";
import Services from "./features/landing/Services";
import WorkGallery from "./features/landing/WorkGallery";
import BookingModal from "./features/booking/BookingModal";

import AdminPage from "./features/admin/AdminPage";
import AdminRankingPage from "./features/admin/AdminRankingPage"; // ✅ NUEVO
import AdminSettingsPage from "./features/admin/AdminSettingsPage";
import LoginPage from "./features/auth/LoginPage";
import RequireAuth from "./features/auth/RequireAuth";
import PlatformLoginPage from "./features/platform/PlatformLoginPage";
import PlatformDashboardPage from "./features/platform/PlatformDashboardPage";

// ✅ NUEVO
import DisplayPage from "./pages/display/DisplayPage";

import { heroImages } from "./lib/data";
import { apiFetch, getApiUrl } from "./lib/api";

/* ---------- LANDING ---------- */
function normalizeInstagramUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const username = raw.replace(/^@+/, "").replace(/^instagram\.com\//i, "");
  return username ? `https://instagram.com/${username}` : "";
}

function normalizeWhatsAppUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits}`;
}

function buildHeroSlides(brandName, tagline, heroSlides) {
  const normalizedBrand = String(brandName || "").trim() || "Tu Estilo - Barberia";
  const normalizedTagline = String(tagline || "").trim() || "Cortes modernos, clasicos y afeitado premium.";

  const fallbackSlides = [
    {
      src: heroImages[0]?.src || "/hero/hero1.jpg",
      title: normalizedBrand,
      subtitle: normalizedTagline,
    },
    {
      src: heroImages[1]?.src || heroImages[0]?.src || "/hero/hero1.jpg",
      title: `Atencion personalizada en ${normalizedBrand}`,
      subtitle: "Elegi tu barbero y reserva en minutos.",
    },
    {
      src: heroImages[2]?.src || heroImages[1]?.src || heroImages[0]?.src || "/hero/hero1.jpg",
      title: "Experiencia completa",
      subtitle: "Detalles, estilo y precision en cada turno.",
    },
  ];

  if (!Array.isArray(heroSlides) || !heroSlides.length) return fallbackSlides;

  return fallbackSlides.map((fallbackSlide, idx) => {
    const incoming = heroSlides[idx] || {};
    const title = String(incoming?.title || "").trim();
    const subtitle = String(incoming?.subtitle || "").trim();
    const rawImageUrl = String(incoming?.imageUrl || "").trim();
    const imageUrl = rawImageUrl
      ? (rawImageUrl.startsWith("http") ? rawImageUrl : `${getApiUrl()}${rawImageUrl}`)
      : "";
    return {
      ...fallbackSlide,
      src: imageUrl || fallbackSlide.src,
      title: title || fallbackSlide.title,
      subtitle: subtitle || fallbackSlide.subtitle,
    };
  });
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        fill="currentColor"
        d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2Zm0 1.8A3.95 3.95 0 0 0 3.8 7.75v8.5a3.95 3.95 0 0 0 3.95 3.95h8.5a3.95 3.95 0 0 0 3.95-3.95v-8.5a3.95 3.95 0 0 0-3.95-3.95h-8.5Zm8.95 1.35a1.05 1.05 0 1 1 0 2.1 1.05 1.05 0 0 1 0-2.1ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.8A3.2 3.2 0 1 0 12 15.2a3.2 3.2 0 0 0 0-6.4Z"
      />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
      <path
        fill="currentColor"
        d="M12.01 2a9.99 9.99 0 0 0-8.66 14.98L2 22l5.2-1.35A10 10 0 1 0 12.01 2Zm0 18.15a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.08.8.82-3-.2-.31A8.15 8.15 0 1 1 12 20.15Zm4.48-6.08c-.25-.13-1.5-.73-1.73-.8-.23-.08-.39-.13-.56.12-.17.25-.64.8-.79.97-.15.17-.3.2-.55.08-.25-.13-1.06-.39-2.01-1.24a7.64 7.64 0 0 1-1.39-1.72c-.15-.25-.02-.39.11-.52.11-.11.25-.3.38-.45.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.07-.13-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.42h-.48c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1s.9 2.44 1.02 2.61c.13.17 1.77 2.7 4.29 3.79.6.26 1.06.41 1.43.52.6.19 1.14.16 1.56.1.48-.07 1.5-.61 1.71-1.2.21-.59.21-1.1.15-1.2-.06-.1-.23-.16-.48-.29Z"
      />
    </svg>
  );
}

function SuspendedPage({ message, billing }) {
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");

  async function handlePayNow() {
    if (paying) return;
    setPaying(true);
    setPayError("");
    try {
      const data = await apiFetch("/billing/public/mercadopago/start", {
        method: "POST",
        body: {
          billingMonth: billing?.billingMonth,
        },
      });

      if (data?.alreadyPaid) {
        window.location.reload();
        return;
      }
      if (!data?.checkoutUrl) {
        throw new Error("No se pudo generar el link de pago");
      }
      window.location.href = data.checkoutUrl;
    } catch (e) {
      setPayError(e.message || "No se pudo iniciar el pago online");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-zinc-950 px-4 text-zinc-100">
      <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-zinc-900/60 p-8 text-center shadow-2xl shadow-black/50 md:p-12">
        <div className="text-6xl md:text-7xl">:(</div>
        <h1 className="mt-4 text-3xl font-black uppercase tracking-wide text-amber-300 md:text-5xl">
          Aplicacion suspendida
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-200 md:text-2xl">
          {message || "Comunicate con tu administrador para dar de alta."}
        </p>

        {billing?.canPayOnline ? (
          <div className="mt-8">
            <button
              onClick={handlePayNow}
              disabled={paying}
              className="rounded-xl bg-amber-400 px-5 py-3 text-sm font-semibold text-zinc-950 hover:bg-amber-300 disabled:opacity-60"
            >
              {paying
                ? "Redirigiendo al pago..."
                : billing?.onlinePaymentMode === "subscription"
                ? "Activar débito automático"
                : "Pagar mes ahora"}
            </button>
          </div>
        ) : null}

        {payError ? (
          <div className="mx-auto mt-4 max-w-xl rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-200 ring-1 ring-red-500/30">
            {payError}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function buildSuspendedMessageFromError(err) {
  const fallback = "Comunicate con tu administrador para dar de alta.";
  const trial = err?.payload?.trial;
  if (trial?.expired) {
    const billing = err?.payload?.billing || {};
    const fee = Number(billing.monthlyFeeArs) || 30000;
    const methods = Array.isArray(billing.acceptedMethods) ? billing.acceptedMethods : [];
    const methodsText = methods.length ? methods.join(", ") : "transferencia, mercado_pago, efectivo";
    return `Tu período de prueba de 30 días finalizó. Para continuar, aboná ARS ${fee} (medios: ${methodsText}) o comunicate con tu administrador.`;
  }

  const billing = err?.payload?.billing;
  if (!billing) return err?.message || fallback;

  const methods = Array.isArray(billing.acceptedMethods) ? billing.acceptedMethods : [];
  const methodsText = methods.length ? methods.join(", ") : "transferencia, mercado_pago, efectivo";
  const fee = Number(billing.monthlyFeeArs) || 30000;
  const dueDay = Number(billing.dueDay) || 5;

  return `Aplicacion suspendida por falta de pago. Abona ARS ${fee} del 1 al ${dueDay}. Medios: ${methodsText}. Comunicate con tu administrador para dar de alta.`;
}

function Landing({
  onOpenBooking,
  services,
  galleryPhotos,
  brandName,
  tagline,
  heroSlidesConfig,
  contactPhone,
  contactWhatsapp,
  contactInstagram,
  address,
}) {
  const heroSlides = buildHeroSlides(brandName, tagline, heroSlidesConfig);
  const instagramUrl = normalizeInstagramUrl(contactInstagram);
  const whatsappUrl = normalizeWhatsAppUrl(contactWhatsapp);

  return (
    <>
      <HeroSlider slides={heroSlides} onOpenBooking={onOpenBooking} brandName={brandName} />
      <Services items={services} contactWhatsapp={contactWhatsapp} />
      <WorkGallery photos={galleryPhotos} onOpenBooking={onOpenBooking} />
      <section className="border-t border-white/10 bg-zinc-950/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 text-sm text-zinc-300 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            {tagline ? <p className="font-semibold text-zinc-100">{tagline}</p> : null}
            <p className="text-zinc-400">
              {contactPhone ? `Tel: ${contactPhone}` : ""}{contactPhone && address ? " • " : ""}{address || ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {instagramUrl ? (
              <a
                href={instagramUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 font-semibold text-zinc-100 ring-1 ring-white/10 hover:bg-white/10"
                aria-label="Instagram de la barberia"
              >
                <InstagramIcon />
                Instagram
              </a>
            ) : null}
          </div>
        </div>
      </section>
      <footer className="border-t border-white/10 py-10 text-center text-sm text-zinc-500">
        {brandName} • © {new Date().getFullYear()}
      </footer>
      {whatsappUrl ? (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Contactar por WhatsApp"
          className="fixed bottom-5 right-5 z-50 inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 transition hover:scale-105 hover:bg-emerald-400"
        >
          <WhatsAppIcon />
        </a>
      ) : null}
    </>
  );
}

/* ---------- APP ---------- */
export default function App() {
  const location = useLocation();
  const [openBooking, setOpenBooking] = useState(false);
  const [barbers, setBarbers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [services, setServices] = useState([]);
  const [galleryPhotos, setGalleryPhotos] = useState([]);
  const [brandName, setBrandName] = useState("");
  const [tagline, setTagline] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [heroSlidesConfig, setHeroSlidesConfig] = useState([]);
  const [contactPhone, setContactPhone] = useState("");
  const [contactWhatsapp, setContactWhatsapp] = useState("");
  const [contactInstagram, setContactInstagram] = useState("");
  const [address, setAddress] = useState("");
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [tenantSuspended, setTenantSuspended] = useState(false);
  const [tenantSuspendedMessage, setTenantSuspendedMessage] = useState(
    "Comunicate con tu administrador para dar de alta."
  );
  const [tenantSuspendedBilling, setTenantSuspendedBilling] = useState(null);

  useEffect(() => {
    let alive = true;

    async function loadCatalog() {
      setLoadingCatalog(true);
      setCatalogError("");
      setTenantSuspended(false);
      setTenantSuspendedBilling(null);

      try {
        const [barbersData, branchesData, servicesData, tenantConfig] = await Promise.all([
          apiFetch("/barbers"),
          apiFetch("/branches"),
          apiFetch("/services"),
          apiFetch("/tenant-config/public"),
        ]);

        if (!alive) return;

        setBarbers(Array.isArray(barbersData) ? barbersData : []);
        setBranches(Array.isArray(branchesData) ? branchesData : []);
        setServices(Array.isArray(servicesData) ? servicesData : []);

        const galleryFromApi = Array.isArray(tenantConfig?.gallery)
          ? tenantConfig.gallery
              .filter((g) => g?.isActive && g?.imageUrl)
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
              .map((g) => {
                if (String(g.imageUrl).startsWith("http")) return g.imageUrl;
                return `${getApiUrl()}${g.imageUrl}`;
              })
          : [];
        setGalleryPhotos(galleryFromApi);

        setBrandName(tenantConfig?.settings?.brandName || "");
        setTagline(tenantConfig?.settings?.tagline || "");
        setContactPhone(tenantConfig?.settings?.contactPhone || "");
        setContactWhatsapp(tenantConfig?.settings?.contactWhatsapp || "");
        setContactInstagram(tenantConfig?.settings?.contactInstagram || "");
        setAddress(tenantConfig?.settings?.address || "");
        const incomingLogoUrl = String(tenantConfig?.settings?.logoUrl || "").trim();
        setLogoUrl(
          incomingLogoUrl
            ? (incomingLogoUrl.startsWith("http") ? incomingLogoUrl : `${getApiUrl()}${incomingLogoUrl}`)
            : ""
        );
        setHeroSlidesConfig(
          Array.isArray(tenantConfig?.settings?.heroSlides) ? tenantConfig.settings.heroSlides : []
        );
      } catch (e) {
        if (!alive) return;
        if (e?.code === "TENANT_SUSPENDED" || e?.status === 403) {
          setTenantSuspended(true);
          setTenantSuspendedMessage(buildSuspendedMessageFromError(e));
          setTenantSuspendedBilling(e?.payload?.billing || null);
          setCatalogError("");
          return;
        }
        setCatalogError(e.message || "Error cargando catálogo");
      } finally {
        if (alive) setLoadingCatalog(false);
      }
    }

    loadCatalog();
    return () => {
      alive = false;
    };
  }, []);

  const authRoute = location.pathname === "/login";
  const platformRoute = location.pathname.startsWith("/platform");
  if (tenantSuspended && !authRoute && !platformRoute) {
    return <SuspendedPage message={tenantSuspendedMessage} billing={tenantSuspendedBilling} />;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 notranslate" translate="no">
      {/* NAVBAR SOLO EN LANDING */}
      <Routes>
        <Route
          path="/"
          element={
            <Navbar
              onOpenBooking={() => setOpenBooking(true)}
              brandName={brandName}
              tagline={tagline}
              logoUrl={logoUrl}
            />
          }
        />
        {/* En login, admin, ranking y display NO hay navbar */}
        <Route path="/login" element={null} />
        <Route path="/admin" element={null} />
        <Route path="/admin/ranking" element={null} /> {/* ✅ NUEVO */}
        <Route path="/admin/settings" element={null} />
        <Route path="/display" element={null} />
        <Route path="/display/:branchSlug" element={null} />
        <Route path="/platform/login" element={null} />
        <Route path="/platform" element={null} />
      </Routes>

      {/* CONTENIDO */}
      <main>
        <Routes>
          {/* LANDING */}
          <Route
            path="/"
            element={
              loadingCatalog ? (
                <section className="grid min-h-[60vh] place-items-center px-4">
                  <div className="text-center text-zinc-400">
                    <div className="text-sm font-semibold uppercase tracking-wider">Cargando sitio...</div>
                  </div>
                </section>
              ) : (
                <Landing
                  onOpenBooking={() => setOpenBooking(true)}
                  services={services}
                  galleryPhotos={galleryPhotos}
                  brandName={brandName}
                  tagline={tagline}
                  heroSlidesConfig={heroSlidesConfig}
                  contactPhone={contactPhone}
                  contactWhatsapp={contactWhatsapp}
                  contactInstagram={contactInstagram}
                  address={address}
                />
              )
            }
          />

          {/* LOGIN */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/platform/login" element={<PlatformLoginPage />} />
          <Route path="/platform" element={<PlatformDashboardPage />} />

          {/* ADMIN (PROTEGIDO) */}
          <Route
            path="/admin"
            element={
              <RequireAuth allowedRoles={["admin", "barber"]}>
                <AdminPage
                  barbers={barbers}
                  branches={branches}
                  services={services}
                  loadingCatalog={loadingCatalog}
                  catalogError={catalogError}
                />
              </RequireAuth>
            }
          />

          {/* ✅ RANKING (PROTEGIDO) */}
          <Route
            path="/admin/ranking"
            element={
              <RequireAuth allowedRoles={["admin", "barber"]}>
                <AdminRankingPage />
              </RequireAuth>
            }
          />

          <Route
            path="/admin/settings"
            element={
              <RequireAuth allowedRoles={["admin"]}>
                <AdminSettingsPage />
              </RequireAuth>
            }
          />

          {/* ✅ DISPLAY (PANTALLA TV) */}
          <Route
            path="/display"
            element={
              <DisplayPage
                barbers={barbers}
                branches={branches}
                services={services}
                loadingCatalog={loadingCatalog}
                catalogError={catalogError}
                brandName={brandName}
              />
            }
          />

          <Route
            path="/display/:branchSlug"
            element={
              <DisplayPage
                barbers={barbers}
                branches={branches}
                services={services}
                loadingCatalog={loadingCatalog}
                catalogError={catalogError}
                brandName={brandName}
              />
            }
          />
        </Routes>
      </main>

      {/* MODAL DE TURNOS (solo landing lo abre) */}
      <BookingModal
        open={openBooking}
        onClose={() => setOpenBooking(false)}
        branches={branches}
        barbers={barbers}
        services={services}
        contactWhatsapp={contactWhatsapp}
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Container from "../../components/Container";
import { apiFetch, getApiUrl } from "../../lib/api";

const DAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const DEFAULT_HERO_SLIDES = [
  {
    imageUrl: "",
    title: "Tu Estilo - Barberia",
    subtitle: "Cortes modernos, clasicos y afeitado premium.",
  },
  {
    imageUrl: "",
    title: "Atencion personalizada",
    subtitle: "Elegi tu barbero y reserva en minutos.",
  },
  {
    imageUrl: "",
    title: "Experiencia completa",
    subtitle: "Detalles, estilo y precision en cada turno.",
  },
];

function normalizeHeroSlides(incomingSlides) {
  return DEFAULT_HERO_SLIDES.map((fallback, idx) => {
    const incoming = Array.isArray(incomingSlides) ? incomingSlides[idx] || {} : {};
    return {
      imageUrl: String(incoming?.imageUrl || "").trim(),
      title: String(incoming?.title || "").trim() || fallback.title,
      subtitle: String(incoming?.subtitle || "").trim() || fallback.subtitle,
    };
  });
}

function emptyHours() {
  return DAY_LABELS.map((_, i) => ({
    dayOfWeek: i,
    isClosed: i === 0,
    open1: i === 0 ? null : "09:30",
    close1: i >= 1 && i <= 4 ? "13:00" : i >= 5 ? "14:00" : null,
    open2: i >= 1 && i <= 4 ? "18:00" : i >= 5 ? "16:00" : null,
    close2: i >= 1 && i <= 4 ? "21:30" : i >= 5 ? "22:00" : null,
  }));
}

function SectionCard({ title, subtitle, children }) {
  return (
    <section className="rounded-2xl bg-zinc-900/40 p-5 ring-1 ring-white/10 space-y-4">
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-zinc-400">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default function AdminSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [inlineSaveMsg, setInlineSaveMsg] = useState({});

  const [settings, setSettings] = useState({
    brandName: "",
    tagline: "",
    contactPhone: "",
    contactWhatsapp: "",
    contactInstagram: "",
    address: "",
    logoUrl: "",
    heroMode: "generic",
    heroSlides: normalizeHeroSlides(DEFAULT_HERO_SLIDES),
  });
  const [branches, setBranches] = useState([]);
  const [multiBranchEnabled, setMultiBranchEnabled] = useState(false);
  const [barbers, setBarbers] = useState([]);
  const [services, setServices] = useState([]);
  const [galleryDraft, setGalleryDraft] = useState([]);
  const [draggingId, setDraggingId] = useState(null);

  const [newBarber, setNewBarber] = useState("");
  const [newBarberCommissionPct, setNewBarberCommissionPct] = useState("0");
  const [newBarberBranchId, setNewBarberBranchId] = useState("");
  const [barbersBranchFilter, setBarbersBranchFilter] = useState("all");
  const [scheduleBranchFilter, setScheduleBranchFilter] = useState("all");
  const [newBranchName, setNewBranchName] = useState("");
  const [newService, setNewService] = useState({ name: "", price: "", durationMin: "30" });
  const [galleryFile, setGalleryFile] = useState(null);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [galleryOrdering, setGalleryOrdering] = useState(false);
  const [gallerySuccessMsg, setGallerySuccessMsg] = useState("");
  const [logoFile, setLogoFile] = useState(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [heroSlideFiles, setHeroSlideFiles] = useState([null, null, null]);
  const [heroSlideUploading, setHeroSlideUploading] = useState([false, false, false]);
  const [barberSchedules, setBarberSchedules] = useState([]);
  const [selectedBarberScheduleId, setSelectedBarberScheduleId] = useState("");
  const [selectedBarberWeekly, setSelectedBarberWeekly] = useState(emptyHours());
  const [selectedBarberExceptions, setSelectedBarberExceptions] = useState([]);
  const [savingBarberWeekly, setSavingBarberWeekly] = useState(false);
  const [savingException, setSavingException] = useState(false);
  const [newBarberException, setNewBarberException] = useState({
    date: "",
    isClosed: true,
    open1: "",
    close1: "",
    open2: "",
    close2: "",
    note: "",
  });
  const [barberCommissionDraft, setBarberCommissionDraft] = useState({});

  async function reloadAll() {
    setLoading(true);
    setError("");
    try {
      const [cfg, branchRows, bs, ss, barberScheduleResp] = await Promise.all([
        apiFetch("/tenant-config/admin"),
        apiFetch("/branches?includeInactive=1"),
        apiFetch("/barbers"),
        apiFetch("/services"),
        apiFetch("/tenant-config/barber-schedules"),
      ]);

      const incomingSettings = cfg.settings || {};
      setSettings((prev) => ({
        ...prev,
        ...incomingSettings,
        heroSlides: normalizeHeroSlides(incomingSettings.heroSlides),
      }));
      setGalleryDraft(Array.isArray(cfg.gallery) ? cfg.gallery : []);
      setMultiBranchEnabled(!!cfg?.multiBranchEnabled);
      const nextBranches = Array.isArray(branchRows) ? branchRows : [];
      setBranches(nextBranches);
      if (!newBarberBranchId) {
        const firstActive = nextBranches.find((b) => b.isActive);
        if (firstActive) setNewBarberBranchId(String(firstActive.id));
      }
      setBarbers(Array.isArray(bs) ? bs : []);
      setBarberCommissionDraft(
        Object.fromEntries(
          (Array.isArray(bs) ? bs : []).map((b) => [b.id, String(Number(b.commissionPct || 0))])
        )
      );
      setServices(Array.isArray(ss) ? ss : []);
      const incomingSchedules = Array.isArray(barberScheduleResp?.schedules)
        ? barberScheduleResp.schedules
        : [];
      setBarberSchedules(incomingSchedules);

      const activeScheduleIds = incomingSchedules
        .filter((s) => !!s?.isActive)
        .map((s) => String(s.barberId));
      const nextSelectedId =
        selectedBarberScheduleId && activeScheduleIds.includes(String(selectedBarberScheduleId))
          ? String(selectedBarberScheduleId)
          : activeScheduleIds[0] || "";
      setSelectedBarberScheduleId(nextSelectedId);

      const selectedSchedule = incomingSchedules.find(
        (s) => String(s.barberId) === String(nextSelectedId)
      );
      setSelectedBarberWeekly(
        Array.isArray(selectedSchedule?.weekly) && selectedSchedule.weekly.length === 7
          ? selectedSchedule.weekly
          : emptyHours()
      );
      setSelectedBarberExceptions(
        Array.isArray(selectedSchedule?.exceptions) ? selectedSchedule.exceptions : []
      );
    } catch (e) {
      setError(e.message || "Error cargando configuración");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const selected = barberSchedules.find(
      (s) => String(s.barberId) === String(selectedBarberScheduleId)
    );
    setSelectedBarberWeekly(
      Array.isArray(selected?.weekly) && selected.weekly.length === 7
        ? selected.weekly
        : emptyHours()
    );
    setSelectedBarberExceptions(Array.isArray(selected?.exceptions) ? selected.exceptions : []);
  }, [barberSchedules, selectedBarberScheduleId]);

  const activeBranches = useMemo(
    () => (Array.isArray(branches) ? branches.filter((b) => !!b.isActive) : []),
    [branches]
  );

  const filteredBarbersByBranch = useMemo(() => {
    if (!multiBranchEnabled || barbersBranchFilter === "all") return barbers;
    return barbers.filter((b) => String(b.branchId) === String(barbersBranchFilter));
  }, [barbers, multiBranchEnabled, barbersBranchFilter]);

  const filteredBarberSchedules = useMemo(() => {
    if (!multiBranchEnabled || scheduleBranchFilter === "all") return barberSchedules;
    return barberSchedules.filter((s) => String(s.branchId) === String(scheduleBranchFilter));
  }, [barberSchedules, multiBranchEnabled, scheduleBranchFilter]);

  useEffect(() => {
    const activeFiltered = filteredBarberSchedules.filter((s) => !!s.isActive);
    if (!activeFiltered.length) {
      setSelectedBarberScheduleId("");
      return;
    }
    const exists = activeFiltered.some(
      (s) => String(s.barberId) === String(selectedBarberScheduleId)
    );
    if (!exists) {
      setSelectedBarberScheduleId(String(activeFiltered[0].barberId));
    }
  }, [filteredBarberSchedules, selectedBarberScheduleId]);

  useEffect(() => {
    if (!multiBranchEnabled) return;
    if (barbersBranchFilter === "all") return;
    setNewBarberBranchId(String(barbersBranchFilter));
  }, [multiBranchEnabled, barbersBranchFilter]);

  function markOk(msg) {
    setOkMsg(msg);
    setTimeout(() => setOkMsg(""), 2500);
  }

  function markGalleryOk(msg) {
    setGallerySuccessMsg(msg);
    setTimeout(() => setGallerySuccessMsg(""), 3500);
  }

  function markInlineSaveOk(key, msg) {
    setInlineSaveMsg((prev) => ({ ...prev, [key]: msg }));
    setTimeout(() => {
      setInlineSaveMsg((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, 2200);
  }

  const galleryCards = useMemo(
    () =>
      galleryDraft.map((g) => ({
        ...g,
        absoluteUrl: String(g.imageUrl).startsWith("http")
          ? g.imageUrl
          : `${getApiUrl()}${g.imageUrl}`,
      })),
    [galleryDraft]
  );

  const logoPreviewUrl = useMemo(() => {
    const url = String(settings.logoUrl || "").trim();
    if (!url) return "";
    return url.startsWith("http") ? url : `${getApiUrl()}${url}`;
  }, [settings.logoUrl]);

  const heroSlidePreviewUrls = useMemo(
    () =>
      normalizeHeroSlides(settings.heroSlides).map((slide) => {
        const url = String(slide?.imageUrl || "").trim();
        if (!url) return "";
        return url.startsWith("http") ? url : `${getApiUrl()}${url}`;
      }),
    [settings.heroSlides]
  );

  async function saveSettings(saveKey = "settings", okText = "Configuración guardada") {
    setError("");
    try {
      await apiFetch("/tenant-config/settings", { method: "PUT", body: settings });
      markOk("Marca y contacto guardados");
      markInlineSaveOk(saveKey, okText);
    } catch (e) {
      setError(e.message || "No se pudo guardar marca y contacto");
    }
  }

  function updateHeroSlide(idx, field, value) {
    const next = normalizeHeroSlides(settings.heroSlides);
    const current = next[idx] || { imageUrl: "", title: "", subtitle: "" };
    next[idx] = { ...current, [field]: value };
    setSettings({ ...settings, heroSlides: next });
  }

  async function addBarber() {
    if (!newBarber.trim()) return;
    setError("");
    try {
      await apiFetch("/barbers", {
        method: "POST",
        body: {
          name: newBarber.trim(),
          commissionPct: Number(newBarberCommissionPct || 0),
          branchId: newBarberBranchId ? Number(newBarberBranchId) : undefined,
        },
      });
      setNewBarber("");
      setNewBarberCommissionPct("0");
      await reloadAll();
      markOk("Barbero agregado");
    } catch (e) {
      setError(e.message || "No se pudo agregar barbero");
    }
  }

  async function removeBarber(id) {
    if (!window.confirm("¿Seguro que querés eliminar (desactivar) este barbero?")) return;
    setError("");
    try {
      await apiFetch(`/barbers/${id}`, { method: "DELETE" });
      await reloadAll();
      markOk("Barbero desactivado");
    } catch (e) {
      setError(e.message || "No se pudo desactivar barbero");
    }
  }

  async function saveBarberCommission(id) {
    setError("");
    try {
      const value = Number(barberCommissionDraft[id] || 0);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        setError("Comisión inválida (0 a 100)");
        return;
      }
      await apiFetch(`/barbers/${id}`, {
        method: "PATCH",
        body: { commissionPct: value },
      });
      await reloadAll();
      markOk("Comisión actualizada");
    } catch (e) {
      setError(e.message || "No se pudo actualizar comisión");
    }
  }

  async function saveSelectedBarberWeekly() {
    if (!selectedBarberScheduleId) return;
    setError("");
    try {
      setSavingBarberWeekly(true);
      await apiFetch(`/tenant-config/barber-schedules/${selectedBarberScheduleId}/weekly`, {
        method: "PUT",
        body: { hours: selectedBarberWeekly },
      });
      await reloadAll();
      markOk("Horario del barbero guardado");
      markInlineSaveOk("barberWeekly", "Guardado");
    } catch (e) {
      setError(e.message || "No se pudo guardar horario del barbero");
    } finally {
      setSavingBarberWeekly(false);
    }
  }

  async function saveBarberException() {
    if (!selectedBarberScheduleId) return;
    if (!newBarberException.date) return;
    setError("");
    try {
      setSavingException(true);
      await apiFetch(`/tenant-config/barber-schedules/${selectedBarberScheduleId}/exceptions`, {
        method: "POST",
        body: {
          date: newBarberException.date,
          isClosed: newBarberException.isClosed,
          open1: newBarberException.open1 || null,
          close1: newBarberException.close1 || null,
          open2: newBarberException.open2 || null,
          close2: newBarberException.close2 || null,
          note: newBarberException.note || "",
        },
      });
      setNewBarberException({
        date: "",
        isClosed: true,
        open1: "",
        close1: "",
        open2: "",
        close2: "",
        note: "",
      });
      await reloadAll();
      markOk("Excepción guardada");
      markInlineSaveOk("barberException", "Guardada");
    } catch (e) {
      setError(e.message || "No se pudo guardar excepción");
    } finally {
      setSavingException(false);
    }
  }

  async function removeBarberException(dateValue) {
    if (!selectedBarberScheduleId || !dateValue) return;
    if (!window.confirm("¿Seguro que querés eliminar esta excepción de horario?")) return;
    setError("");
    try {
      await apiFetch(
        `/tenant-config/barber-schedules/${selectedBarberScheduleId}/exceptions/${dateValue}`,
        { method: "DELETE" }
      );
      await reloadAll();
      markOk("Excepción eliminada");
    } catch (e) {
      setError(e.message || "No se pudo eliminar excepción");
    }
  }

  async function addBranch() {
    if (!multiBranchEnabled) {
      setError("Multi-sucursal deshabilitado. Pedile a plataforma que lo habilite.");
      return;
    }
    if (!newBranchName.trim()) return;
    setError("");
    try {
      await apiFetch("/branches", {
        method: "POST",
        body: { name: newBranchName.trim() },
      });
      setNewBranchName("");
      await reloadAll();
      markOk("Sucursal agregada");
    } catch (e) {
      setError(e.message || "No se pudo agregar sucursal");
    }
  }

  async function removeBranch(id) {
    if (!window.confirm("¿Seguro que querés eliminar (desactivar) esta sucursal?")) return;
    setError("");
    try {
      await apiFetch(`/branches/${id}`, { method: "DELETE" });
      await reloadAll();
      markOk("Sucursal desactivada");
    } catch (e) {
      setError(e.message || "No se pudo desactivar sucursal");
    }
  }

  async function deleteBranchPermanent(id) {
    if (!window.confirm("¿Seguro que querés eliminar definitivamente esta sucursal desactivada? Esta acción no se puede deshacer.")) return;
    setError("");
    try {
      await apiFetch(`/branches/${id}/permanent`, { method: "DELETE" });
      await reloadAll();
      markOk("Sucursal eliminada definitivamente");
    } catch (e) {
      setError(e.message || "No se pudo eliminar definitivamente la sucursal");
    }
  }

  async function addService() {
    if (!newService.name.trim()) return;
    setError("");
    try {
      await apiFetch("/services", {
        method: "POST",
        body: {
          name: newService.name.trim(),
          price: Number(newService.price),
          durationMin: Number(newService.durationMin),
        },
      });
      setNewService({ name: "", price: "", durationMin: "30" });
      await reloadAll();
      markOk("Servicio agregado");
    } catch (e) {
      setError(e.message || "No se pudo agregar servicio");
    }
  }

  async function removeService(id) {
    if (!window.confirm("¿Seguro que querés eliminar (desactivar) este servicio?")) return;
    setError("");
    try {
      await apiFetch(`/services/${id}`, { method: "DELETE" });
      await reloadAll();
      markOk("Servicio desactivado");
    } catch (e) {
      setError(e.message || "No se pudo desactivar servicio");
    }
  }

  async function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
      reader.readAsDataURL(file);
    });
  }

  async function loadImageFromFile(file) {
    const dataUrl = await fileToDataURL(file);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Archivo de imagen inválido"));
      img.src = dataUrl;
    });
  }

  async function processToWebpDataUrl(file) {
    if (!file) throw new Error("Seleccioná una imagen");
    if (!String(file.type || "").startsWith("image/")) {
      throw new Error("Formato inválido. Elegí jpg, png o webp.");
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("Imagen demasiado pesada. Máximo 10MB.");
    }

    const img = await loadImageFromFile(file);
    const targetW = 1200;
    const targetH = 1500;
    const targetRatio = targetW / targetH;
    const srcRatio = img.width / img.height;

    let sx = 0;
    let sy = 0;
    let sw = img.width;
    let sh = img.height;

    if (srcRatio > targetRatio) {
      sw = Math.round(img.height * targetRatio);
      sx = Math.round((img.width - sw) / 2);
    } else {
      sh = Math.round(img.width / targetRatio);
      sy = Math.round((img.height - sh) / 2);
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!blob) throw new Error("No se pudo procesar la imagen");
    if (blob.size > 1_500_000) {
      throw new Error("Imagen resultante demasiado pesada. Probá con una foto más liviana.");
    }

    return fileToDataURL(blob);
  }

  async function processLogoToWebpDataUrl(file) {
    if (!file) throw new Error("Seleccioná un logo");
    if (!String(file.type || "").startsWith("image/")) {
      throw new Error("Formato inválido. Elegí png, jpg o webp.");
    }
    if (file.size > 6 * 1024 * 1024) {
      throw new Error("Logo demasiado pesado. Máximo 6MB.");
    }

    const img = await loadImageFromFile(file);
    const maxSide = 512;
    const scale = Math.min(maxSide / img.width, maxSide / img.height, 1);
    const drawW = Math.max(1, Math.round(img.width * scale));
    const drawH = Math.max(1, Math.round(img.height * scale));
    const dx = Math.floor((maxSide - drawW) / 2);
    const dy = Math.floor((maxSide - drawH) / 2);

    const canvas = document.createElement("canvas");
    canvas.width = maxSide;
    canvas.height = maxSide;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, maxSide, maxSide);
    ctx.drawImage(img, dx, dy, drawW, drawH);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
    if (!blob) throw new Error("No se pudo procesar el logo");
    if (blob.size > 700_000) {
      throw new Error("Logo resultante demasiado pesado. Probá uno más liviano.");
    }
    return fileToDataURL(blob);
  }

  async function processHeroToWebpDataUrl(file) {
    if (!file) throw new Error("Seleccioná una imagen del hero");
    if (!String(file.type || "").startsWith("image/")) {
      throw new Error("Formato inválido. Elegí jpg, png o webp.");
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("Imagen demasiado pesada. Máximo 10MB.");
    }

    const img = await loadImageFromFile(file);
    const targetW = 1920;
    const targetH = 1080;
    const targetRatio = targetW / targetH;
    const srcRatio = img.width / img.height;

    let sx = 0;
    let sy = 0;
    let sw = img.width;
    let sh = img.height;

    if (srcRatio > targetRatio) {
      sw = Math.round(img.height * targetRatio);
      sx = Math.round((img.width - sw) / 2);
    } else {
      sh = Math.round(img.width / targetRatio);
      sy = Math.round((img.height - sh) / 2);
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.84));
    if (!blob) throw new Error("No se pudo procesar la imagen del hero");
    if (blob.size > 2_000_000) {
      throw new Error("Imagen resultante demasiado pesada. Probá otra más liviana.");
    }
    return fileToDataURL(blob);
  }

  async function uploadLogo() {
    if (!logoFile) return;
    setError("");
    try {
      setLogoUploading(true);
      const imageBase64 = await processLogoToWebpDataUrl(logoFile);
      const resp = await apiFetch("/tenant-config/logo/upload", {
        method: "POST",
        body: { imageBase64 },
      });
      setSettings({
        ...settings,
        logoUrl: String(resp?.logoUrl || ""),
      });
      setLogoFile(null);
      markOk("Logo actualizado");
    } catch (e) {
      setError(e.message || "No se pudo subir el logo");
    } finally {
      setLogoUploading(false);
    }
  }

  async function removeLogo() {
    if (!window.confirm("¿Seguro que querés quitar el logo actual?")) return;
    setError("");
    try {
      await apiFetch("/tenant-config/logo", { method: "DELETE" });
      setSettings({ ...settings, logoUrl: "" });
      setLogoFile(null);
      markOk("Logo eliminado");
    } catch (e) {
      setError(e.message || "No se pudo eliminar el logo");
    }
  }

  async function uploadHeroSlideImage(idx) {
    const file = heroSlideFiles[idx];
    if (!file) return;
    setError("");
    try {
      setHeroSlideUploading((prev) => {
        const next = [...prev];
        next[idx] = true;
        return next;
      });
      const imageBase64 = await processHeroToWebpDataUrl(file);
      const slideNo = idx + 1;
      const resp = await apiFetch(`/tenant-config/hero-slides/${slideNo}/upload`, {
        method: "POST",
        body: { imageBase64 },
      });
      const nextSlides = normalizeHeroSlides(settings.heroSlides);
      nextSlides[idx] = { ...nextSlides[idx], imageUrl: String(resp?.imageUrl || "") };
      setSettings({ ...settings, heroSlides: nextSlides });
      setHeroSlideFiles((prev) => {
        const next = [...prev];
        next[idx] = null;
        return next;
      });
      markOk(`Imagen del slide ${slideNo} actualizada`);
      markInlineSaveOk(`heroImage${slideNo}`, "Imagen actualizada");
    } catch (e) {
      setError(e.message || "No se pudo subir la imagen del hero");
    } finally {
      setHeroSlideUploading((prev) => {
        const next = [...prev];
        next[idx] = false;
        return next;
      });
    }
  }

  async function removeHeroSlideImage(idx) {
    const slideNo = idx + 1;
    if (!window.confirm(`¿Seguro que querés quitar la imagen del slide ${slideNo}?`)) return;
    setError("");
    try {
      await apiFetch(`/tenant-config/hero-slides/${slideNo}/image`, { method: "DELETE" });
      const nextSlides = normalizeHeroSlides(settings.heroSlides);
      nextSlides[idx] = { ...nextSlides[idx], imageUrl: "" };
      setSettings({ ...settings, heroSlides: nextSlides });
      setHeroSlideFiles((prev) => {
        const next = [...prev];
        next[idx] = null;
        return next;
      });
      markOk(`Imagen del slide ${slideNo} eliminada`);
      markInlineSaveOk(`heroImage${slideNo}`, "Imagen eliminada");
    } catch (e) {
      setError(e.message || "No se pudo eliminar la imagen del hero");
    }
  }

  async function addGallery() {
    if (!galleryFile) return;
    setError("");
    try {
      setGalleryUploading(true);
      const imageBase64 = await processToWebpDataUrl(galleryFile);
      await apiFetch("/tenant-config/gallery/upload", {
        method: "POST",
        body: { imageBase64, caption: "", sortOrder: galleryDraft.length + 1 },
      });
      setGalleryFile(null);
      await reloadAll();
      markOk("Imagen agregada");
      markGalleryOk("Imagen subida correctamente. La galería fue actualizada.");
    } catch (e) {
      setError(e.message || "No se pudo agregar imagen");
    } finally {
      setGalleryUploading(false);
    }
  }

  async function removeGallery(id) {
    if (!window.confirm("¿Seguro que querés eliminar esta imagen de la galería?")) return;
    setError("");
    try {
      await apiFetch(`/tenant-config/gallery/${id}`, { method: "DELETE" });
      await reloadAll();
      markOk("Imagen eliminada");
    } catch (e) {
      setError(e.message || "No se pudo eliminar imagen");
    }
  }

  function reorderDraft(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const fromIdx = galleryDraft.findIndex((g) => g.id === fromId);
    const toIdx = galleryDraft.findIndex((g) => g.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;

    const next = [...galleryDraft];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setGalleryDraft(next);
  }

  async function saveGalleryOrder() {
    setError("");
    try {
      setGalleryOrdering(true);
      await apiFetch("/tenant-config/gallery/reorder", {
        method: "PUT",
        body: { ids: galleryDraft.map((g) => g.id) },
      });
      await reloadAll();
      markOk("Orden de galería guardado");
      markGalleryOk("Orden de imágenes guardado correctamente.");
      markInlineSaveOk("galleryOrder", "Guardado");
    } catch (e) {
      setError(e.message || "No se pudo guardar el orden de la galería");
    } finally {
      setGalleryOrdering(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-zinc-950/80 backdrop-blur">
        <Container className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm text-zinc-400">Admin</div>
            <div className="text-lg font-black">Configuración del negocio</div>
          </div>
          <Link
            to="/admin"
            className="rounded-xl px-4 py-2 text-sm font-semibold hover:bg-white/10"
          >
            Volver a agenda
          </Link>
        </Container>
      </header>

      <Container className="py-8 space-y-8">
        {loading ? <div className="text-zinc-400">Cargando...</div> : null}
        {error ? (
          <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
        ) : null}
        {okMsg ? (
          <div className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {okMsg}
          </div>
        ) : null}

        <SectionCard
          title="Marca y Contacto"
          subtitle="Esto se muestra en la landing pública de esta barbería."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <input
              className="rounded-xl bg-zinc-900 px-3 py-2"
              placeholder="Nombre de barbería (ej: Barbería Centro 2)"
              value={settings.brandName}
              onChange={(e) => setSettings({ ...settings, brandName: e.target.value })}
            />
            <input
              className="rounded-xl bg-zinc-900 px-3 py-2"
              placeholder="Frase corta / slogan"
              value={settings.tagline}
              onChange={(e) => setSettings({ ...settings, tagline: e.target.value })}
            />
            <input
              className="rounded-xl bg-zinc-900 px-3 py-2"
              placeholder="Teléfono de contacto"
              value={settings.contactPhone}
              onChange={(e) => setSettings({ ...settings, contactPhone: e.target.value })}
            />
            <input
              className="rounded-xl bg-zinc-900 px-3 py-2"
              placeholder="WhatsApp"
              value={settings.contactWhatsapp}
              onChange={(e) => setSettings({ ...settings, contactWhatsapp: e.target.value })}
            />
            <input
              className="rounded-xl bg-zinc-900 px-3 py-2"
              placeholder="Instagram (usuario o URL)"
              value={settings.contactInstagram}
              onChange={(e) => setSettings({ ...settings, contactInstagram: e.target.value })}
            />
            <input
              className="rounded-xl bg-zinc-900 px-3 py-2"
              placeholder="Dirección"
              value={settings.address}
              onChange={(e) => setSettings({ ...settings, address: e.target.value })}
            />
          </div>
          <div className="rounded-xl bg-zinc-900/70 p-3 ring-1 ring-white/10">
            <div className="mb-2 text-sm font-semibold">Logo (navbar)</div>
            <div className="mb-3 text-xs text-zinc-400">
              Se adapta automáticamente: se normaliza a 512x512 y se muestra sin deformar.
            </div>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-xl bg-zinc-950 ring-1 ring-white/10">
                {logoPreviewUrl ? (
                  <img src={logoPreviewUrl} alt="Logo actual" className="h-14 w-14 object-contain" />
                ) : (
                  <span className="text-xs text-zinc-500">Sin logo</span>
                )}
              </div>
              <input
                type="file"
                accept="image/*"
                className="flex-1 rounded-xl bg-zinc-900 px-3 py-2"
                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              />
              <button
                onClick={uploadLogo}
                disabled={!logoFile || logoUploading}
                className="w-full rounded-xl bg-amber-400 px-4 py-2 font-semibold text-zinc-950 disabled:opacity-60 md:w-auto"
              >
                {logoUploading ? "Subiendo..." : "Subir logo"}
              </button>
              <button
                onClick={removeLogo}
                disabled={!settings.logoUrl}
                className="w-full rounded-xl bg-zinc-800 px-4 py-2 font-semibold text-zinc-100 disabled:opacity-50 md:w-auto"
              >
                Quitar logo
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => saveSettings("brandContact", "Guardado")}
              className="w-full rounded-xl bg-amber-400 px-4 py-2 font-semibold text-zinc-950 sm:w-auto"
            >
              Guardar marca y contacto
            </button>
            {inlineSaveMsg.brandContact ? (
              <span className="text-sm font-semibold text-emerald-300">{inlineSaveMsg.brandContact}</span>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title="Textos del Hero"
          subtitle="Editá textos e imágenes del slider principal (16:9 recomendado)."
        >
          <div className="grid gap-4 md:grid-cols-3">
            {normalizeHeroSlides(settings.heroSlides).map(
              (slide, idx) => (
                <div key={`hero-slide-${idx + 1}`} className="space-y-2 rounded-xl bg-zinc-900/70 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    Slide {idx + 1}
                  </div>
                  <div className="overflow-hidden rounded-xl bg-zinc-950 ring-1 ring-white/10">
                    {heroSlidePreviewUrls[idx] ? (
                      <img
                        src={heroSlidePreviewUrls[idx]}
                        alt={`Preview slide ${idx + 1}`}
                        className="h-28 w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-28 place-items-center text-xs text-zinc-500">
                        Imagen por defecto
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      className="w-full rounded-xl bg-zinc-900 px-3 py-2 text-sm"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setHeroSlideFiles((prev) => {
                          const next = [...prev];
                          next[idx] = file;
                          return next;
                        });
                      }}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => uploadHeroSlideImage(idx)}
                        disabled={!heroSlideFiles[idx] || heroSlideUploading[idx]}
                        className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 disabled:opacity-60"
                      >
                        {heroSlideUploading[idx] ? "Subiendo..." : "Subir imagen"}
                      </button>
                      <button
                        onClick={() => removeHeroSlideImage(idx)}
                        disabled={!slide?.imageUrl}
                        className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-100 disabled:opacity-50"
                      >
                        Quitar imagen
                      </button>
                      {inlineSaveMsg[`heroImage${idx + 1}`] ? (
                        <span className="text-xs font-semibold text-emerald-300">
                          {inlineSaveMsg[`heroImage${idx + 1}`]}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <input
                    className="w-full rounded-xl bg-zinc-900 px-3 py-2"
                    placeholder={`Titulo slide ${idx + 1}`}
                    value={slide?.title || ""}
                    onChange={(e) => updateHeroSlide(idx, "title", e.target.value)}
                  />
                  <textarea
                    className="min-h-20 w-full rounded-xl bg-zinc-900 px-3 py-2"
                    placeholder={`Subtitulo slide ${idx + 1}`}
                    value={slide?.subtitle || ""}
                    onChange={(e) => updateHeroSlide(idx, "subtitle", e.target.value)}
                  />
                </div>
              )
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => saveSettings("heroTexts", "Guardado")}
              className="w-full rounded-xl bg-amber-400 px-4 py-2 font-semibold text-zinc-950 sm:w-auto"
            >
              Guardar textos del hero
            </button>
            {inlineSaveMsg.heroTexts ? (
              <span className="text-sm font-semibold text-emerald-300">{inlineSaveMsg.heroTexts}</span>
            ) : null}
          </div>
        </SectionCard>

        {multiBranchEnabled ? (
          <SectionCard
            title="Sucursales"
            subtitle="Gestioná sucursales dentro de la misma barbería (tenant)."
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="flex-1 rounded-xl bg-zinc-900 px-3 py-2"
                placeholder="Nombre de la sucursal"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
              />
              <button
                onClick={addBranch}
                className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-zinc-950"
              >
                Agregar sucursal
              </button>
            </div>
            <div className="space-y-2">
              {branches.length ? (
                branches.map((b) => (
                  <div
                    key={b.id}
                    className="flex flex-col items-start gap-2 rounded-xl bg-zinc-900/80 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="font-medium">{b.name}</div>
                      <div className="text-xs text-zinc-400">
                        slug: {b.slug} · {b.isActive ? "Activa" : "Inactiva"}
                      </div>
                    </div>
                    {b.isActive ? (
                      <button
                        onClick={() => removeBranch(b.id)}
                        className="rounded-lg bg-red-500/20 px-3 py-1 text-xs text-red-200 hover:bg-red-500/30"
                      >
                        Desactivar
                      </button>
                    ) : (
                      <button
                        onClick={() => deleteBranchPermanent(b.id)}
                        className="rounded-lg bg-red-600/30 px-3 py-1 text-xs text-red-100 hover:bg-red-600/40"
                      >
                        Eliminar definitivo
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-sm text-zinc-400">No hay sucursales cargadas todavía.</div>
              )}
            </div>
          </SectionCard>
        ) : (
          <SectionCard
            title="Sucursales"
            subtitle="Multi-sucursal deshabilitado por plataforma. Se usa solo Sucursal Principal."
          />
        )}

        <SectionCard
          title="Barberos"
          subtitle="Aquí gestionás la cantidad de barberos visibles para turnos."
        >
          {multiBranchEnabled ? (
            <div className="grid gap-2 sm:max-w-xs">
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Filtrar listado por sucursal
              </label>
              <select
                value={barbersBranchFilter}
                onChange={(e) => setBarbersBranchFilter(e.target.value)}
                className="rounded-xl bg-zinc-900 px-3 py-2"
              >
                <option value="all">Todas las sucursales</option>
                {activeBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="flex-1 rounded-xl bg-zinc-900 px-3 py-2"
              placeholder="Nombre del barbero"
              value={newBarber}
              onChange={(e) => setNewBarber(e.target.value)}
            />
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              className="rounded-xl bg-zinc-900 px-3 py-2 sm:w-44"
              placeholder="% comisión"
              value={newBarberCommissionPct}
              onChange={(e) => setNewBarberCommissionPct(e.target.value)}
            />
            {multiBranchEnabled ? (
              <select
                value={newBarberBranchId}
                onChange={(e) => setNewBarberBranchId(e.target.value)}
                className="rounded-xl bg-zinc-900 px-3 py-2"
              >
                <option value="">Sucursal</option>
                {activeBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-xl bg-zinc-900 px-3 py-2 text-sm text-zinc-400">
                Sucursal: Principal
              </div>
            )}
            <button
              onClick={addBarber}
              className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-zinc-950 sm:w-auto"
            >
              Agregar
            </button>
          </div>
          <div className="space-y-2">
            {filteredBarbersByBranch.length ? (
              filteredBarbersByBranch.map((b) => (
                <div
                  key={b.id}
                  className="flex flex-col items-start gap-2 rounded-xl bg-zinc-900/80 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="w-full">
                    <div>{b.name}</div>
                    <div className="text-xs text-zinc-400">
                      Sucursal:{" "}
                      {branches.find((x) => Number(x.id) === Number(b.branchId))?.name || "-"}
                    </div>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="text-xs text-zinc-400 sm:min-w-28">Comisión (%)</div>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        className="rounded-lg bg-zinc-950 px-2 py-1 text-sm ring-1 ring-white/10 sm:w-32"
                        value={barberCommissionDraft[b.id] ?? String(Number(b.commissionPct || 0))}
                        onChange={(e) =>
                          setBarberCommissionDraft((prev) => ({
                            ...prev,
                            [b.id]: e.target.value,
                          }))
                        }
                      />
                      <button
                        onClick={() => saveBarberCommission(b.id)}
                        className="rounded-lg bg-zinc-800 px-3 py-1 text-xs text-zinc-100 hover:bg-zinc-700"
                      >
                        Guardar %
                      </button>
                    </div>
                  </div>
                  <div className="w-full sm:w-auto">
                    <button
                      onClick={() => removeBarber(b.id)}
                      className="rounded-lg bg-red-500/20 px-3 py-1 text-xs text-red-200 hover:bg-red-500/30"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-zinc-400">
                No hay barberos cargados para el filtro seleccionado.
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Horarios por Barbero"
          subtitle="Configurá qué días y horas trabaja cada barbero. El turnero mostrará solo su disponibilidad."
        >
          <div className="grid gap-3 md:grid-cols-3">
            {multiBranchEnabled ? (
              <select
                value={scheduleBranchFilter}
                onChange={(e) => setScheduleBranchFilter(e.target.value)}
                className="rounded-xl bg-zinc-900 px-3 py-2"
              >
                <option value="all">Todas las sucursales</option>
                {activeBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              value={selectedBarberScheduleId}
              onChange={(e) => setSelectedBarberScheduleId(e.target.value)}
              className="rounded-xl bg-zinc-900 px-3 py-2"
            >
              <option value="">Seleccionar barbero</option>
              {filteredBarberSchedules
                .filter((s) => s.isActive)
                .map((s) => (
                  <option key={s.barberId} value={s.barberId}>
                    {s.barberName}
                  </option>
                ))}
            </select>
          </div>

          {!selectedBarberScheduleId && filteredBarberSchedules.filter((s) => s.isActive).length === 0 ? (
            <div className="text-sm text-zinc-400">
              No hay barberos activos para la sucursal seleccionada.
            </div>
          ) : null}

          {selectedBarberScheduleId ? (
            <>
              <div className="space-y-2">
                {selectedBarberWeekly.map((h, idx) => (
                  <div
                    key={`barber-weekly-${h.dayOfWeek}`}
                    className="grid gap-2 rounded-xl bg-zinc-900/30 p-3 md:grid-cols-7 md:items-center"
                  >
                    <div className="font-medium md:col-span-2">{DAY_LABELS[idx]}</div>
                    <label className="text-sm">
                      <input
                        type="checkbox"
                        checked={h.isClosed}
                        onChange={(e) => {
                          const next = [...selectedBarberWeekly];
                          next[idx] = { ...h, isClosed: e.target.checked };
                          setSelectedBarberWeekly(next);
                        }}
                      />{" "}
                      No trabaja
                    </label>
                    <input
                      disabled={h.isClosed}
                      type="time"
                      className="w-full rounded bg-zinc-900 px-2 py-1 disabled:opacity-40"
                      value={h.open1 || ""}
                      onChange={(e) => {
                        const next = [...selectedBarberWeekly];
                        next[idx] = { ...h, open1: e.target.value };
                        setSelectedBarberWeekly(next);
                      }}
                    />
                    <input
                      disabled={h.isClosed}
                      type="time"
                      className="w-full rounded bg-zinc-900 px-2 py-1 disabled:opacity-40"
                      value={h.close1 || ""}
                      onChange={(e) => {
                        const next = [...selectedBarberWeekly];
                        next[idx] = { ...h, close1: e.target.value };
                        setSelectedBarberWeekly(next);
                      }}
                    />
                    <input
                      disabled={h.isClosed}
                      type="time"
                      className="w-full rounded bg-zinc-900 px-2 py-1 disabled:opacity-40"
                      value={h.open2 || ""}
                      onChange={(e) => {
                        const next = [...selectedBarberWeekly];
                        next[idx] = { ...h, open2: e.target.value };
                        setSelectedBarberWeekly(next);
                      }}
                    />
                    <input
                      disabled={h.isClosed}
                      type="time"
                      className="w-full rounded bg-zinc-900 px-2 py-1 disabled:opacity-40"
                      value={h.close2 || ""}
                      onChange={(e) => {
                        const next = [...selectedBarberWeekly];
                        next[idx] = { ...h, close2: e.target.value };
                        setSelectedBarberWeekly(next);
                      }}
                    />
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={saveSelectedBarberWeekly}
                  disabled={savingBarberWeekly}
                  className="w-full rounded-xl bg-amber-400 px-4 py-2 font-semibold text-zinc-950 sm:w-auto disabled:opacity-60"
                >
                  {savingBarberWeekly ? "Guardando..." : "Guardar horario del barbero"}
                </button>
                {inlineSaveMsg.barberWeekly ? (
                  <span className="text-sm font-semibold text-emerald-300">{inlineSaveMsg.barberWeekly}</span>
                ) : null}
              </div>

              <div className="rounded-xl bg-zinc-900/40 p-4 ring-1 ring-white/10 space-y-3">
                <h4 className="text-sm font-bold">Excepciones por fecha</h4>
                <p className="text-xs text-zinc-400">
                  Para francos, feriados o cambios puntuales de horario.
                </p>
                <div className="grid gap-2 md:grid-cols-4">
                  <input
                    type="date"
                    value={newBarberException.date}
                    onChange={(e) =>
                      setNewBarberException((prev) => ({ ...prev, date: e.target.value }))
                    }
                    className="rounded-xl bg-zinc-900 px-3 py-2"
                  />
                  <label className="flex items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={newBarberException.isClosed}
                      onChange={(e) =>
                        setNewBarberException((prev) => ({ ...prev, isClosed: e.target.checked }))
                      }
                    />
                    No trabaja ese día
                  </label>
                  <input
                    type="time"
                    disabled={newBarberException.isClosed}
                    value={newBarberException.open1}
                    onChange={(e) =>
                      setNewBarberException((prev) => ({ ...prev, open1: e.target.value }))
                    }
                    className="rounded-xl bg-zinc-900 px-3 py-2 disabled:opacity-40"
                  />
                  <input
                    type="time"
                    disabled={newBarberException.isClosed}
                    value={newBarberException.close1}
                    onChange={(e) =>
                      setNewBarberException((prev) => ({ ...prev, close1: e.target.value }))
                    }
                    className="rounded-xl bg-zinc-900 px-3 py-2 disabled:opacity-40"
                  />
                  <input
                    type="time"
                    disabled={newBarberException.isClosed}
                    value={newBarberException.open2}
                    onChange={(e) =>
                      setNewBarberException((prev) => ({ ...prev, open2: e.target.value }))
                    }
                    className="rounded-xl bg-zinc-900 px-3 py-2 disabled:opacity-40"
                  />
                  <input
                    type="time"
                    disabled={newBarberException.isClosed}
                    value={newBarberException.close2}
                    onChange={(e) =>
                      setNewBarberException((prev) => ({ ...prev, close2: e.target.value }))
                    }
                    className="rounded-xl bg-zinc-900 px-3 py-2 disabled:opacity-40"
                  />
                  <input
                    type="text"
                    placeholder="Nota (opcional)"
                    value={newBarberException.note}
                    onChange={(e) =>
                      setNewBarberException((prev) => ({ ...prev, note: e.target.value }))
                    }
                    className="rounded-xl bg-zinc-900 px-3 py-2 md:col-span-2"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={saveBarberException}
                    disabled={savingException || !newBarberException.date}
                    className="w-full rounded-xl bg-zinc-800 px-4 py-2 font-semibold text-zinc-100 sm:w-auto disabled:opacity-50"
                  >
                    {savingException ? "Guardando..." : "Guardar excepción"}
                  </button>
                  {inlineSaveMsg.barberException ? (
                    <span className="text-sm font-semibold text-emerald-300">{inlineSaveMsg.barberException}</span>
                  ) : null}
                </div>

                <div className="space-y-2">
                  {selectedBarberExceptions.length ? (
                    selectedBarberExceptions.map((ex) => (
                      <div
                        key={`${ex.date}-${ex.id}`}
                        className="flex flex-col items-start gap-2 rounded-xl bg-zinc-900/80 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="text-sm">
                          <span className="font-semibold">{ex.date}</span>{" "}
                          {ex.isClosed
                            ? "• No trabaja"
                            : `• ${ex.open1 || "--:--"}-${ex.close1 || "--:--"}${
                                ex.open2 && ex.close2 ? ` y ${ex.open2}-${ex.close2}` : ""
                              }`}
                          {ex.note ? ` • ${ex.note}` : ""}
                        </div>
                        <button
                          onClick={() => removeBarberException(ex.date)}
                          className="rounded-lg bg-red-500/20 px-3 py-1 text-xs text-red-200 hover:bg-red-500/30"
                        >
                          Eliminar
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-zinc-400">Sin excepciones cargadas.</div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="text-sm text-zinc-400">
              Seleccioná un barbero para editar su disponibilidad.
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Servicios y Precios"
          subtitle="Cada servicio necesita nombre, precio en ARS y duración en minutos."
        >
          <div className="grid gap-2 md:grid-cols-4">
            <input
              className="rounded-xl bg-zinc-900 px-3 py-2"
              placeholder="Nombre del servicio"
              value={newService.name}
              onChange={(e) => setNewService({ ...newService, name: e.target.value })}
            />
            <input
              className="rounded-xl bg-zinc-900 px-3 py-2"
              placeholder="Precio ARS (ej: 12000)"
              value={newService.price}
              onChange={(e) => setNewService({ ...newService, price: e.target.value })}
            />
            <input
              className="rounded-xl bg-zinc-900 px-3 py-2"
              placeholder="Duración min (ej: 30)"
              value={newService.durationMin}
              onChange={(e) => setNewService({ ...newService, durationMin: e.target.value })}
            />
            <button
              onClick={addService}
              className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-zinc-950"
            >
              Agregar
            </button>
          </div>
          <div className="space-y-2">
            {services.length ? (
              services.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-col items-start gap-2 rounded-xl bg-zinc-900/80 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-zinc-400">
                      ${s.price} ARS · {s.durationMin} min
                    </div>
                  </div>
                  <button
                    onClick={() => removeService(s.id)}
                    className="rounded-lg bg-red-500/20 px-3 py-1 text-xs text-red-200 hover:bg-red-500/30"
                  >
                    Eliminar
                  </button>
                </div>
              ))
            ) : (
              <div className="text-sm text-zinc-400">No hay servicios cargados todavía.</div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Galería de Trabajos"
          subtitle="Estas imágenes reemplazan la sección 3 (Trabajos realizados) de la landing. Se normalizan a formato 4:5."
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="file"
              accept="image/*"
              className="flex-1 rounded-xl bg-zinc-900 px-3 py-2"
              onChange={(e) => setGalleryFile(e.target.files?.[0] || null)}
            />
            <button
              onClick={addGallery}
              disabled={!galleryFile || galleryUploading}
              className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-zinc-950"
            >
              {galleryUploading ? "Procesando..." : "Subir imagen"}
            </button>
          </div>
          <div className="text-xs text-zinc-400">
            Sugerencia: cargá entre 6 y 12 imágenes. Se recortan al centro en 4:5, tamaño final 1200x1500.
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-zinc-400">
              Arrastrá y soltá para reordenar. Luego guardá el orden.
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={saveGalleryOrder}
                disabled={!galleryDraft.length || galleryOrdering}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold hover:bg-zinc-700 disabled:opacity-50"
              >
                {galleryOrdering ? "Guardando..." : "Guardar orden"}
              </button>
              {inlineSaveMsg.galleryOrder ? (
                <span className="text-xs font-semibold text-emerald-300">{inlineSaveMsg.galleryOrder}</span>
              ) : null}
            </div>
          </div>
          {gallerySuccessMsg ? (
            <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 ring-1 ring-emerald-400/20">
              {gallerySuccessMsg}
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-3">
            {galleryCards.length ? (
              galleryCards.map((g, idx) => (
                <div
                  key={g.id}
                  className={[
                    "rounded-xl bg-zinc-900 p-2",
                    draggingId === g.id ? "ring-2 ring-amber-400/60" : "ring-1 ring-white/10",
                  ].join(" ")}
                  draggable
                  onDragStart={() => setDraggingId(g.id)}
                  onDragEnd={() => setDraggingId(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    reorderDraft(draggingId, g.id);
                    setDraggingId(null);
                  }}
                >
                  <img src={g.absoluteUrl} alt="" className="h-56 w-full rounded object-cover" />
                  <div className="mt-2 text-xs text-zinc-400">Orden: {idx + 1}</div>
                  <button
                    onClick={() => removeGallery(g.id)}
                    className="mt-2 w-full rounded bg-red-500/20 py-1 text-xs text-red-200 hover:bg-red-500/30"
                  >
                    Eliminar
                  </button>
                </div>
              ))
            ) : (
              <div className="text-sm text-zinc-400">No hay imágenes cargadas todavía.</div>
            )}
          </div>
        </SectionCard>
      </Container>
    </div>
  );
}

const express = require("express");
const { pool } = require("../db");
const { auth } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");
const { uploadTenantImage, deleteManagedImageByUrl } = require("../services/media-storage");

const router = express.Router();

function normalizeTime(v) {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  return s.length === 5 ? `${s}:00` : s;
}

function toPublicTime(v) {
  if (!v) return null;
  const s = String(v);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function mapBusinessHours(rows) {
  return rows
    .map((r) => ({
      dayOfWeek: Number(r.day_of_week),
      isClosed: !!r.is_closed,
      open1: toPublicTime(r.open1),
      close1: toPublicTime(r.close1),
      open2: toPublicTime(r.open2),
      close2: toPublicTime(r.close2),
      open3: toPublicTime(r.open3),
      close3: toPublicTime(r.close3),
      open4: toPublicTime(r.open4),
      close4: toPublicTime(r.close4),
      open5: toPublicTime(r.open5),
      close5: toPublicTime(r.close5),
    }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

function emptyWeeklyHours() {
  return Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i,
    isClosed: true,
    open1: null,
    close1: null,
    open2: null,
    close2: null,
    open3: null,
    close3: null,
    open4: null,
    close4: null,
    open5: null,
    close5: null,
  }));
}

function mapBarberExceptionRows(rows) {
  return rows.map((r) => ({
    id: Number(r.id),
    barberId: Number(r.barber_id),
    date: String(r.date_value),
    isClosed: !!r.is_closed,
    open1: toPublicTime(r.open1),
    close1: toPublicTime(r.close1),
    open2: toPublicTime(r.open2),
    close2: toPublicTime(r.close2),
    open3: toPublicTime(r.open3),
    close3: toPublicTime(r.close3),
    open4: toPublicTime(r.open4),
    close4: toPublicTime(r.close4),
    open5: toPublicTime(r.open5),
    close5: toPublicTime(r.close5),
    note: String(r.note || ""),
  }));
}

function normalizeHeroText(v, maxLen) {
  return String(v || "").trim().slice(0, maxLen);
}

function normalizeHeroImageUrl(v) {
  const s = String(v || "").trim().slice(0, 500);
  if (!s) return "";
  if (s.startsWith("/uploads/") || s.startsWith("http://") || s.startsWith("https://")) return s;
  return "";
}

function getHeroImageColumnBySlideNo(slideNo) {
  const n = Number(slideNo);
  if (n === 1) return "hero_slide_1_image_url";
  if (n === 2) return "hero_slide_2_image_url";
  if (n === 3) return "hero_slide_3_image_url";
  return "";
}

function buildDefaultHeroSlides(brandName, tagline) {
  const safeBrandName = String(brandName || "").trim() || "Tu Estilo - Barberia";
  const safeTagline =
    String(tagline || "").trim() || "Cortes modernos, clasicos y afeitado premium.";

  return [
    {
      title: safeBrandName,
      subtitle: safeTagline,
    },
    {
      title: `Atencion personalizada en ${safeBrandName}`,
      subtitle: "Elegi tu barbero y reserva en minutos.",
    },
    {
      title: "Experiencia completa",
      subtitle: "Detalles, estilo y precision en cada turno.",
    },
  ];
}

function buildHeroSlidesFromRow(row) {
  const defaults = buildDefaultHeroSlides(row?.brand_name, row?.tagline);
  return [
    {
      imageUrl: normalizeHeroImageUrl(row?.hero_slide_1_image_url),
      title: normalizeHeroText(row?.hero_slide_1_title, 120) || defaults[0].title,
      subtitle: normalizeHeroText(row?.hero_slide_1_subtitle, 255) || defaults[0].subtitle,
    },
    {
      imageUrl: normalizeHeroImageUrl(row?.hero_slide_2_image_url),
      title: normalizeHeroText(row?.hero_slide_2_title, 120) || defaults[1].title,
      subtitle: normalizeHeroText(row?.hero_slide_2_subtitle, 255) || defaults[1].subtitle,
    },
    {
      imageUrl: normalizeHeroImageUrl(row?.hero_slide_3_image_url),
      title: normalizeHeroText(row?.hero_slide_3_title, 120) || defaults[2].title,
      subtitle: normalizeHeroText(row?.hero_slide_3_subtitle, 255) || defaults[2].subtitle,
    },
  ];
}

async function getTenantConfig(tenantId) {
  const [[settingsRow]] = await pool.query(
    `SELECT
       brand_name, tagline, contact_phone, contact_whatsapp, contact_instagram, address, logo_url, hero_mode,
       hero_slide_1_image_url, hero_slide_2_image_url, hero_slide_3_image_url,
       hero_slide_1_title, hero_slide_1_subtitle,
       hero_slide_2_title, hero_slide_2_subtitle,
       hero_slide_3_title, hero_slide_3_subtitle
     FROM tenant_settings
     WHERE tenant_id = :tenantId
     LIMIT 1`,
    { tenantId }
  );

  const [hoursRows] = await pool.query(
    `SELECT day_of_week, is_closed, open1, close1, open2, close2, open3, close3, open4, close4, open5, close5
     FROM business_hours
     WHERE tenant_id = :tenantId
     ORDER BY day_of_week ASC`,
    { tenantId }
  );

  const [galleryRows] = await pool.query(
    `SELECT id, image_url, caption, sort_order, is_active
     FROM tenant_gallery
     WHERE tenant_id = :tenantId
     ORDER BY sort_order ASC, id ASC`,
    { tenantId }
  );

  return {
    settings: settingsRow
      ? {
          brandName: settingsRow.brand_name,
          tagline: settingsRow.tagline || "",
          contactPhone: settingsRow.contact_phone || "",
          contactWhatsapp: settingsRow.contact_whatsapp || "",
          contactInstagram: settingsRow.contact_instagram || "",
          address: settingsRow.address || "",
          logoUrl: settingsRow.logo_url || "",
          heroMode: settingsRow.hero_mode || "generic",
          heroSlides: buildHeroSlidesFromRow(settingsRow),
        }
      : null,
    businessHours: mapBusinessHours(hoursRows),
    gallery: galleryRows.map((g) => ({
      id: g.id,
      imageUrl: g.image_url,
      caption: g.caption || "",
      sortOrder: Number(g.sort_order) || 0,
      isActive: !!g.is_active,
    })),
  };
}

router.get("/public", async (req, res) => {
  try {
    const data = await getTenantConfig(req.tenant.id);
    res.json({
      ...data,
      multiBranchEnabled: Number(req.tenant?.multi_branch_enabled || 0) === 1,
      bookingPayment: {
        required: Number(req.tenant?.booking_payment_required || 0) === 1,
        provider:
          Number(req.tenant?.booking_payment_required || 0) === 1
            ? String(req.tenant?.booking_payment_provider || "mercado_pago")
            : "none",
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error leyendo configuración del tenant" });
  }
});

router.get("/admin", auth, requireRole("admin"), async (req, res) => {
  try {
    const data = await getTenantConfig(req.tenant.id);
    res.json({
      ...data,
      multiBranchEnabled: Number(req.tenant?.multi_branch_enabled || 0) === 1,
      bookingPayment: {
        required: Number(req.tenant?.booking_payment_required || 0) === 1,
        provider:
          Number(req.tenant?.booking_payment_required || 0) === 1
            ? String(req.tenant?.booking_payment_provider || "mercado_pago")
            : "none",
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error leyendo configuración admin" });
  }
});

router.put("/settings", auth, requireRole("admin"), async (req, res) => {
  try {
    const brandName = String(req.body?.brandName || "").trim().slice(0, 120);
    if (!brandName) return res.status(400).json({ error: "brandName requerido" });

    const heroMode = req.body?.heroMode === "custom" ? "custom" : "generic";
    const incomingHeroSlides = Array.isArray(req.body?.heroSlides) ? req.body.heroSlides : [];
    const defaultHeroSlides = buildDefaultHeroSlides(brandName, req.body?.tagline);
    const slide1 = incomingHeroSlides[0] || {};
    const slide2 = incomingHeroSlides[1] || {};
    const slide3 = incomingHeroSlides[2] || {};

    const payload = {
      tenantId: req.tenant.id,
      brandName,
      tagline: String(req.body?.tagline || "").trim().slice(0, 255),
      contactPhone: String(req.body?.contactPhone || "").trim().slice(0, 25),
      contactWhatsapp: String(req.body?.contactWhatsapp || "").trim().slice(0, 25),
      contactInstagram: String(req.body?.contactInstagram || "").trim().slice(0, 80),
      address: String(req.body?.address || "").trim().slice(0, 255),
      logoUrl: String(req.body?.logoUrl || "").trim().slice(0, 500),
      heroMode,
      heroSlide1Title:
        normalizeHeroText(slide1?.title, 120) || defaultHeroSlides[0].title,
      heroSlide1ImageUrl: normalizeHeroImageUrl(slide1?.imageUrl),
      heroSlide1Subtitle:
        normalizeHeroText(slide1?.subtitle, 255) || defaultHeroSlides[0].subtitle,
      heroSlide2Title:
        normalizeHeroText(slide2?.title, 120) || defaultHeroSlides[1].title,
      heroSlide2ImageUrl: normalizeHeroImageUrl(slide2?.imageUrl),
      heroSlide2Subtitle:
        normalizeHeroText(slide2?.subtitle, 255) || defaultHeroSlides[1].subtitle,
      heroSlide3Title:
        normalizeHeroText(slide3?.title, 120) || defaultHeroSlides[2].title,
      heroSlide3ImageUrl: normalizeHeroImageUrl(slide3?.imageUrl),
      heroSlide3Subtitle:
        normalizeHeroText(slide3?.subtitle, 255) || defaultHeroSlides[2].subtitle,
    };

    await pool.query(
       `INSERT INTO tenant_settings
       (
         tenant_id, brand_name, tagline, contact_phone, contact_whatsapp, contact_instagram, address, logo_url, hero_mode,
         hero_slide_1_title, hero_slide_1_subtitle, hero_slide_1_image_url,
         hero_slide_2_title, hero_slide_2_subtitle, hero_slide_2_image_url,
         hero_slide_3_title, hero_slide_3_subtitle, hero_slide_3_image_url
       )
       VALUES
       (
         :tenantId, :brandName, :tagline, :contactPhone, :contactWhatsapp, :contactInstagram, :address, :logoUrl, :heroMode,
         :heroSlide1Title, :heroSlide1Subtitle, :heroSlide1ImageUrl,
         :heroSlide2Title, :heroSlide2Subtitle, :heroSlide2ImageUrl,
         :heroSlide3Title, :heroSlide3Subtitle, :heroSlide3ImageUrl
       )
       ON DUPLICATE KEY UPDATE
         brand_name = VALUES(brand_name),
         tagline = VALUES(tagline),
         contact_phone = VALUES(contact_phone),
         contact_whatsapp = VALUES(contact_whatsapp),
         contact_instagram = VALUES(contact_instagram),
         address = VALUES(address),
         logo_url = VALUES(logo_url),
         hero_mode = VALUES(hero_mode),
         hero_slide_1_title = VALUES(hero_slide_1_title),
         hero_slide_1_subtitle = VALUES(hero_slide_1_subtitle),
         hero_slide_1_image_url = VALUES(hero_slide_1_image_url),
         hero_slide_2_title = VALUES(hero_slide_2_title),
         hero_slide_2_subtitle = VALUES(hero_slide_2_subtitle),
         hero_slide_2_image_url = VALUES(hero_slide_2_image_url),
         hero_slide_3_title = VALUES(hero_slide_3_title),
         hero_slide_3_subtitle = VALUES(hero_slide_3_subtitle),
         hero_slide_3_image_url = VALUES(hero_slide_3_image_url)`,
      payload
    );

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error guardando settings" });
  }
});

router.post("/logo/upload", auth, requireRole("admin"), async (req, res) => {
  try {
    const imageBase64 = String(req.body?.imageBase64 || "");
    const base64Payload = imageBase64.includes(",")
      ? imageBase64.split(",").pop()
      : imageBase64;
    if (!base64Payload) return res.status(400).json({ error: "imageBase64 requerido" });

    const buffer = Buffer.from(base64Payload, "base64");
    if (!buffer.length) return res.status(400).json({ error: "Imagen vacía" });
    if (buffer.length > 700_000) {
      return res.status(400).json({ error: "Logo demasiado pesado. Máximo 700KB procesado." });
    }

    const [[existing]] = await pool.query(
      `SELECT logo_url
       FROM tenant_settings
       WHERE tenant_id = :tenantId
       LIMIT 1`,
      { tenantId: req.tenant.id }
    );

    const { url: logoUrl } = await uploadTenantImage({
      tenantId: req.tenant.id,
      folder: "tenant-logos",
      buffer,
      ext: "webp",
      contentType: "image/webp",
    });

    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, brand_name, logo_url)
       VALUES (:tenantId, :brandName, :logoUrl)
       ON DUPLICATE KEY UPDATE
         logo_url = VALUES(logo_url)`,
      {
        tenantId: req.tenant.id,
        brandName: req.tenant.name || `Tenant ${req.tenant.id}`,
        logoUrl,
      }
    );

    await deleteManagedImageByUrl(existing?.logo_url);

    return res.status(201).json({ ok: true, logoUrl });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "Error subiendo logo" });
  }
});

router.delete("/logo", auth, requireRole("admin"), async (req, res) => {
  try {
    const [[existing]] = await pool.query(
      `SELECT logo_url
       FROM tenant_settings
       WHERE tenant_id = :tenantId
       LIMIT 1`,
      { tenantId: req.tenant.id }
    );

    await pool.query(
      `UPDATE tenant_settings
       SET logo_url = NULL
       WHERE tenant_id = :tenantId`,
      { tenantId: req.tenant.id }
    );

    await deleteManagedImageByUrl(existing?.logo_url);

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error eliminando logo" });
  }
});

router.post("/hero-slides/:slideNo/upload", auth, requireRole("admin"), async (req, res) => {
  try {
    const slideNo = Number(req.params.slideNo);
    const imageColumn = getHeroImageColumnBySlideNo(slideNo);
    if (!imageColumn) return res.status(400).json({ error: "slideNo inválido (1..3)" });

    const imageBase64 = String(req.body?.imageBase64 || "");
    const base64Payload = imageBase64.includes(",")
      ? imageBase64.split(",").pop()
      : imageBase64;
    if (!base64Payload) return res.status(400).json({ error: "imageBase64 requerido" });

    const buffer = Buffer.from(base64Payload, "base64");
    if (!buffer.length) return res.status(400).json({ error: "Imagen vacía" });
    if (buffer.length > 2_000_000) {
      return res.status(400).json({ error: "Imagen demasiado pesada. Máximo 2MB procesada." });
    }

    const [[existing]] = await pool.query(
      `SELECT ${imageColumn} AS image_url
       FROM tenant_settings
       WHERE tenant_id = :tenantId
       LIMIT 1`,
      { tenantId: req.tenant.id }
    );

    const { url: imageUrl } = await uploadTenantImage({
      tenantId: req.tenant.id,
      folder: "tenant-hero",
      buffer,
      ext: "webp",
      contentType: "image/webp",
    });

    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, brand_name, ${imageColumn})
       VALUES (:tenantId, :brandName, :imageUrl)
       ON DUPLICATE KEY UPDATE
         ${imageColumn} = VALUES(${imageColumn})`,
      {
        tenantId: req.tenant.id,
        brandName: req.tenant.name || `Tenant ${req.tenant.id}`,
        imageUrl,
      }
    );

    await deleteManagedImageByUrl(existing?.image_url);

    return res.status(201).json({ ok: true, imageUrl, slideNo });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "Error subiendo imagen del hero" });
  }
});

router.delete("/hero-slides/:slideNo/image", auth, requireRole("admin"), async (req, res) => {
  try {
    const slideNo = Number(req.params.slideNo);
    const imageColumn = getHeroImageColumnBySlideNo(slideNo);
    if (!imageColumn) return res.status(400).json({ error: "slideNo inválido (1..3)" });

    const [[existing]] = await pool.query(
      `SELECT ${imageColumn} AS image_url
       FROM tenant_settings
       WHERE tenant_id = :tenantId
       LIMIT 1`,
      { tenantId: req.tenant.id }
    );

    await pool.query(
      `UPDATE tenant_settings
       SET ${imageColumn} = NULL
       WHERE tenant_id = :tenantId`,
      { tenantId: req.tenant.id }
    );

    await deleteManagedImageByUrl(existing?.image_url);

    return res.json({ ok: true, slideNo });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error eliminando imagen del hero" });
  }
});

router.put("/business-hours", auth, requireRole("admin"), async (req, res) => {
  try {
    const hours = Array.isArray(req.body?.hours) ? req.body.hours : null;
    if (!hours || hours.length !== 7) {
      return res.status(400).json({ error: "hours debe incluir 7 días (0..6)" });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const h of hours) {
        const dayOfWeek = Number(h?.dayOfWeek);
        const isClosed = !!h?.isClosed;
        if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
          await conn.rollback();
          return res.status(400).json({ error: "dayOfWeek inválido" });
        }

        const open1 = normalizeTime(h?.open1);
        const close1 = normalizeTime(h?.close1);
        const open2 = normalizeTime(h?.open2);
        const close2 = normalizeTime(h?.close2);
        const open3 = normalizeTime(h?.open3);
        const close3 = normalizeTime(h?.close3);
        const open4 = normalizeTime(h?.open4);
        const close4 = normalizeTime(h?.close4);
        const open5 = normalizeTime(h?.open5);
        const close5 = normalizeTime(h?.close5);

        if (!isClosed && (!open1 || !close1)) {
          await conn.rollback();
          return res.status(400).json({ error: "Cada día abierto requiere open1 y close1" });
        }

        await conn.query(
          `INSERT INTO business_hours
           (tenant_id, day_of_week, is_closed, open1, close1, open2, close2, open3, close3, open4, close4, open5, close5)
           VALUES
           (:tenantId, :dayOfWeek, :isClosed, :open1, :close1, :open2, :close2, :open3, :close3, :open4, :close4, :open5, :close5)
           ON DUPLICATE KEY UPDATE
             is_closed = VALUES(is_closed),
             open1 = VALUES(open1),
             close1 = VALUES(close1),
             open2 = VALUES(open2),
             close2 = VALUES(close2),
             open3 = VALUES(open3),
             close3 = VALUES(close3),
             open4 = VALUES(open4),
             close4 = VALUES(close4),
             open5 = VALUES(open5),
             close5 = VALUES(close5)`,
          {
            tenantId: req.tenant.id,
            dayOfWeek,
            isClosed: isClosed ? 1 : 0,
            open1: isClosed ? null : open1,
            close1: isClosed ? null : close1,
            open2: isClosed ? null : open2,
            close2: isClosed ? null : close2,
            open3: isClosed ? null : open3,
            close3: isClosed ? null : close3,
            open4: isClosed ? null : open4,
            close4: isClosed ? null : close4,
            open5: isClosed ? null : open5,
            close5: isClosed ? null : close5,
          }
        );
      }

      await conn.commit();
      res.json({ ok: true });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error guardando horarios" });
  }
});

router.get("/barber-schedules", auth, requireRole("admin"), async (req, res) => {
  try {
    const [barbers] = await pool.query(
      `SELECT id, full_name, branch_id, is_active
       FROM barbers
       WHERE tenant_id = :tenantId
       ORDER BY is_active DESC, full_name ASC`,
      { tenantId: req.tenant.id }
    );

    const [tenantHoursRows] = await pool.query(
      `SELECT day_of_week, is_closed, open1, close1, open2, close2, open3, close3, open4, close4, open5, close5
       FROM business_hours
       WHERE tenant_id = :tenantId
       ORDER BY day_of_week ASC`,
      { tenantId: req.tenant.id }
    );
    const tenantHours = mapBusinessHours(tenantHoursRows);

    let weeklyRows = [];
    let exceptionRows = [];
    try {
      const [weekly] = await pool.query(
        `SELECT barber_id, day_of_week, is_closed, open1, close1, open2, close2, open3, close3, open4, close4, open5, close5
         FROM barber_business_hours
         WHERE tenant_id = :tenantId`,
        { tenantId: req.tenant.id }
      );
      weeklyRows = weekly;

      const [exceptions] = await pool.query(
        `SELECT id, barber_id, date_value, is_closed, open1, close1, open2, close2, open3, close3, open4, close4, open5, close5, note
         FROM barber_schedule_exceptions
         WHERE tenant_id = :tenantId
         ORDER BY date_value DESC, id DESC`,
        { tenantId: req.tenant.id }
      );
      exceptionRows = exceptions;
    } catch (e) {
      if (e?.code === "ER_NO_SUCH_TABLE") {
        return res.status(500).json({
          error: "Faltan tablas barber_business_hours/barber_schedule_exceptions. Ejecuta migración 009_barber_schedules.sql",
        });
      }
      throw e;
    }

    const weeklyMap = new Map();
    for (const row of weeklyRows) {
      const key = `${row.barber_id}:${row.day_of_week}`;
      weeklyMap.set(key, {
        dayOfWeek: Number(row.day_of_week),
        isClosed: !!row.is_closed,
        open1: toPublicTime(row.open1),
        close1: toPublicTime(row.close1),
        open2: toPublicTime(row.open2),
        close2: toPublicTime(row.close2),
        open3: toPublicTime(row.open3),
        close3: toPublicTime(row.close3),
        open4: toPublicTime(row.open4),
        close4: toPublicTime(row.close4),
        open5: toPublicTime(row.open5),
        close5: toPublicTime(row.close5),
      });
    }

    const exceptionsByBarber = {};
    for (const ex of mapBarberExceptionRows(exceptionRows)) {
      const key = String(ex.barberId);
      if (!exceptionsByBarber[key]) exceptionsByBarber[key] = [];
      exceptionsByBarber[key].push(ex);
    }

    const schedules = barbers.map((b) => {
      const weekly = emptyWeeklyHours();
      for (let day = 0; day <= 6; day += 1) {
        const fromBarber = weeklyMap.get(`${b.id}:${day}`);
        const fromTenant = tenantHours.find((h) => h.dayOfWeek === day) || weekly[day];
        weekly[day] = fromBarber || fromTenant;
      }
      return {
        barberId: Number(b.id),
        barberName: b.full_name,
        branchId: b.branch_id ? Number(b.branch_id) : null,
        isActive: !!b.is_active,
        weekly,
        exceptions: exceptionsByBarber[String(b.id)] || [],
      };
    });

    return res.json({ schedules });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error leyendo horarios de barberos" });
  }
});

router.put("/barber-schedules/:barberId/weekly", auth, requireRole("admin"), async (req, res) => {
  try {
    const barberId = Number(req.params.barberId);
    const hours = Array.isArray(req.body?.hours) ? req.body.hours : null;
    if (!Number.isInteger(barberId) || barberId <= 0) {
      return res.status(400).json({ error: "barberId inválido" });
    }
    if (!hours || hours.length !== 7) {
      return res.status(400).json({ error: "hours debe incluir 7 días (0..6)" });
    }

    const [[barber]] = await pool.query(
      `SELECT id
       FROM barbers
       WHERE id = :barberId AND tenant_id = :tenantId
       LIMIT 1`,
      { barberId, tenantId: req.tenant.id }
    );
    if (!barber) return res.status(404).json({ error: "Barbero no existe" });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const h of hours) {
        const dayOfWeek = Number(h?.dayOfWeek);
        const isClosed = !!h?.isClosed;
        if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
          await conn.rollback();
          return res.status(400).json({ error: "dayOfWeek inválido" });
        }

        const open1 = normalizeTime(h?.open1);
        const close1 = normalizeTime(h?.close1);
        const open2 = normalizeTime(h?.open2);
        const close2 = normalizeTime(h?.close2);
        const open3 = normalizeTime(h?.open3);
        const close3 = normalizeTime(h?.close3);
        const open4 = normalizeTime(h?.open4);
        const close4 = normalizeTime(h?.close4);
        const open5 = normalizeTime(h?.open5);
        const close5 = normalizeTime(h?.close5);
        if (!isClosed && (!open1 || !close1)) {
          await conn.rollback();
          return res.status(400).json({ error: "Cada día abierto requiere open1 y close1" });
        }

        await conn.query(
          `INSERT INTO barber_business_hours
           (tenant_id, barber_id, day_of_week, is_closed, open1, close1, open2, close2, open3, close3, open4, close4, open5, close5)
           VALUES
           (:tenantId, :barberId, :dayOfWeek, :isClosed, :open1, :close1, :open2, :close2, :open3, :close3, :open4, :close4, :open5, :close5)
           ON DUPLICATE KEY UPDATE
             is_closed = VALUES(is_closed),
             open1 = VALUES(open1),
             close1 = VALUES(close1),
             open2 = VALUES(open2),
             close2 = VALUES(close2),
             open3 = VALUES(open3),
             close3 = VALUES(close3),
             open4 = VALUES(open4),
             close4 = VALUES(close4),
             open5 = VALUES(open5),
             close5 = VALUES(close5)`,
          {
            tenantId: req.tenant.id,
            barberId,
            dayOfWeek,
            isClosed: isClosed ? 1 : 0,
            open1: isClosed ? null : open1,
            close1: isClosed ? null : close1,
            open2: isClosed ? null : open2,
            close2: isClosed ? null : close2,
            open3: isClosed ? null : open3,
            close3: isClosed ? null : close3,
            open4: isClosed ? null : open4,
            close4: isClosed ? null : close4,
            open5: isClosed ? null : open5,
            close5: isClosed ? null : close5,
          }
        );
      }
      await conn.commit();
      return res.json({ ok: true });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error guardando horario semanal del barbero" });
  }
});

router.post("/barber-schedules/:barberId/exceptions", auth, requireRole("admin"), async (req, res) => {
  try {
    const barberId = Number(req.params.barberId);
    if (!Number.isInteger(barberId) || barberId <= 0) {
      return res.status(400).json({ error: "barberId inválido" });
    }

    const dateValue = String(req.body?.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      return res.status(400).json({ error: "date inválida (YYYY-MM-DD)" });
    }

    const isClosed = !!req.body?.isClosed;
    const open1 = normalizeTime(req.body?.open1);
    const close1 = normalizeTime(req.body?.close1);
    const open2 = normalizeTime(req.body?.open2);
    const close2 = normalizeTime(req.body?.close2);
    const open3 = normalizeTime(req.body?.open3);
    const close3 = normalizeTime(req.body?.close3);
    const open4 = normalizeTime(req.body?.open4);
    const close4 = normalizeTime(req.body?.close4);
    const open5 = normalizeTime(req.body?.open5);
    const close5 = normalizeTime(req.body?.close5);
    const note = String(req.body?.note || "").trim().slice(0, 140);
    if (!isClosed && (!open1 || !close1)) {
      return res.status(400).json({ error: "Excepción abierta requiere open1 y close1" });
    }

    const [[barber]] = await pool.query(
      `SELECT id
       FROM barbers
       WHERE id = :barberId AND tenant_id = :tenantId
       LIMIT 1`,
      { barberId, tenantId: req.tenant.id }
    );
    if (!barber) return res.status(404).json({ error: "Barbero no existe" });

    await pool.query(
      `INSERT INTO barber_schedule_exceptions
       (tenant_id, barber_id, date_value, is_closed, open1, close1, open2, close2, open3, close3, open4, close4, open5, close5, note)
       VALUES
       (:tenantId, :barberId, :dateValue, :isClosed, :open1, :close1, :open2, :close2, :open3, :close3, :open4, :close4, :open5, :close5, :note)
       ON DUPLICATE KEY UPDATE
         is_closed = VALUES(is_closed),
         open1 = VALUES(open1),
         close1 = VALUES(close1),
         open2 = VALUES(open2),
         close2 = VALUES(close2),
         open3 = VALUES(open3),
         close3 = VALUES(close3),
         open4 = VALUES(open4),
         close4 = VALUES(close4),
         open5 = VALUES(open5),
         close5 = VALUES(close5),
         note = VALUES(note)`,
      {
        tenantId: req.tenant.id,
        barberId,
        dateValue,
        isClosed: isClosed ? 1 : 0,
        open1: isClosed ? null : open1,
        close1: isClosed ? null : close1,
        open2: isClosed ? null : open2,
        close2: isClosed ? null : close2,
        open3: isClosed ? null : open3,
        close3: isClosed ? null : close3,
        open4: isClosed ? null : open4,
        close4: isClosed ? null : close4,
        open5: isClosed ? null : open5,
        close5: isClosed ? null : close5,
        note: note || null,
      }
    );
    return res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error guardando excepción de barbero" });
  }
});

router.delete(
  "/barber-schedules/:barberId/exceptions/:dateValue",
  auth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const barberId = Number(req.params.barberId);
      const dateValue = String(req.params.dateValue || "").trim();
      if (!Number.isInteger(barberId) || barberId <= 0) {
        return res.status(400).json({ error: "barberId inválido" });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        return res.status(400).json({ error: "dateValue inválido (YYYY-MM-DD)" });
      }

      const [del] = await pool.query(
        `DELETE FROM barber_schedule_exceptions
         WHERE tenant_id = :tenantId
           AND barber_id = :barberId
           AND date_value = :dateValue`,
        { tenantId: req.tenant.id, barberId, dateValue }
      );
      return res.json({ ok: true, deleted: del.affectedRows || 0 });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error eliminando excepción de barbero" });
    }
  }
);

router.post("/gallery", auth, requireRole("admin"), async (req, res) => {
  try {
    const imageUrl = String(req.body?.imageUrl || "").trim();
    const caption = String(req.body?.caption || "").trim().slice(0, 140);
    const sortOrder = Number(req.body?.sortOrder) || 0;
    const isActive = req.body?.isActive !== false;

    if (!imageUrl) return res.status(400).json({ error: "imageUrl requerido" });

    const [ins] = await pool.query(
      `INSERT INTO tenant_gallery (tenant_id, image_url, caption, sort_order, is_active)
       VALUES (:tenantId, :imageUrl, :caption, :sortOrder, :isActive)`,
      {
        tenantId: req.tenant.id,
        imageUrl,
        caption,
        sortOrder,
        isActive: isActive ? 1 : 0,
      }
    );

    res.status(201).json({ id: ins.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error creando imagen de galería" });
  }
});

router.post("/gallery/upload", auth, requireRole("admin"), async (req, res) => {
  try {
    const imageBase64 = String(req.body?.imageBase64 || "");
    const caption = String(req.body?.caption || "").trim().slice(0, 140);
    const sortOrder = Number(req.body?.sortOrder) || 0;
    const isActive = req.body?.isActive !== false;

    const base64Payload = imageBase64.includes(",")
      ? imageBase64.split(",").pop()
      : imageBase64;
    if (!base64Payload) return res.status(400).json({ error: "imageBase64 requerido" });

    const buffer = Buffer.from(base64Payload, "base64");
    if (!buffer.length) return res.status(400).json({ error: "Imagen vacía" });
    if (buffer.length > 1_500_000) {
      return res.status(400).json({ error: "Imagen demasiado pesada. Máximo 1.5MB procesada." });
    }

    const { url: imageUrl } = await uploadTenantImage({
      tenantId: req.tenant.id,
      folder: "tenant-gallery",
      buffer,
      ext: "webp",
      contentType: "image/webp",
    });

    const [ins] = await pool.query(
      `INSERT INTO tenant_gallery (tenant_id, image_url, caption, sort_order, is_active)
       VALUES (:tenantId, :imageUrl, :caption, :sortOrder, :isActive)`,
      {
        tenantId: req.tenant.id,
        imageUrl,
        caption,
        sortOrder,
        isActive: isActive ? 1 : 0,
      }
    );

    res.status(201).json({ id: ins.insertId, imageUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e?.message || "Error subiendo imagen de galería" });
  }
});

router.put("/gallery/reorder", auth, requireRole("admin"), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((v) => Number(v)) : [];
    if (!ids.length) return res.status(400).json({ error: "ids requerido" });
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      return res.status(400).json({ error: "ids inválido" });
    }

    const [existingRows] = await pool.query(
      `SELECT id
       FROM tenant_gallery
       WHERE tenant_id = :tenantId`,
      { tenantId: req.tenant.id }
    );
    const existingIds = existingRows.map((r) => Number(r.id)).sort((a, b) => a - b);
    const incomingIds = [...ids].sort((a, b) => a - b);

    if (existingIds.length !== incomingIds.length) {
      return res.status(400).json({ error: "La lista debe incluir todas las imágenes actuales" });
    }
    for (let i = 0; i < existingIds.length; i += 1) {
      if (existingIds[i] !== incomingIds[i]) {
        return res.status(400).json({ error: "La lista de ids no coincide con las imágenes actuales" });
      }
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (let i = 0; i < ids.length; i += 1) {
        await conn.query(
          `UPDATE tenant_gallery
           SET sort_order = :sortOrder
           WHERE id = :id AND tenant_id = :tenantId`,
          { id: ids[i], sortOrder: i + 1, tenantId: req.tenant.id }
        );
      }
      await conn.commit();
      return res.json({ ok: true });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error reordenando galería" });
  }
});

router.patch("/gallery/:id", auth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id inválido" });

    const updates = [];
    const params = { id, tenantId: req.tenant.id };

    if (req.body?.imageUrl !== undefined) {
      updates.push("image_url = :imageUrl");
      params.imageUrl = String(req.body.imageUrl || "").trim();
    }
    if (req.body?.caption !== undefined) {
      updates.push("caption = :caption");
      params.caption = String(req.body.caption || "").trim().slice(0, 140);
    }
    if (req.body?.sortOrder !== undefined) {
      updates.push("sort_order = :sortOrder");
      params.sortOrder = Number(req.body.sortOrder) || 0;
    }
    if (req.body?.isActive !== undefined) {
      updates.push("is_active = :isActive");
      params.isActive = req.body.isActive ? 1 : 0;
    }

    if (!updates.length) return res.status(400).json({ error: "Sin cambios" });

    const [result] = await pool.query(
      `UPDATE tenant_gallery
       SET ${updates.join(", ")}
       WHERE id = :id AND tenant_id = :tenantId`,
      params
    );

    if (!result.affectedRows) return res.status(404).json({ error: "Imagen no existe" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error actualizando imagen de galería" });
  }
});

router.delete("/gallery/:id", auth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id inválido" });

    const [[row]] = await pool.query(
      `SELECT image_url
       FROM tenant_gallery
       WHERE id = :id AND tenant_id = :tenantId
       LIMIT 1`,
      { id, tenantId: req.tenant.id }
    );
    if (!row) return res.status(404).json({ error: "Imagen no existe" });

    const [result] = await pool.query(
      `DELETE FROM tenant_gallery WHERE id = :id AND tenant_id = :tenantId`,
      { id, tenantId: req.tenant.id }
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Imagen no existe" });

    await deleteManagedImageByUrl(row.image_url);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error borrando imagen de galería" });
  }
});

module.exports = router;

const express = require("express");
const { pool } = require("../db");
const { auth } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");

const router = express.Router();

function normalizePrepaymentConfig(payload = {}) {
  const modeRaw = String(payload?.bookingPrepaymentMode || "").trim().toLowerCase();
  const mode = ["none", "total", "percent", "fixed"].includes(modeRaw) ? modeRaw : "none";
  const percentRaw = payload?.bookingPrepaymentPercent;
  const fixedRaw = payload?.bookingPrepaymentFixedArs;
  const percent =
    percentRaw === undefined || percentRaw === null || percentRaw === ""
      ? null
      : Number(percentRaw);
  const fixedArs =
    fixedRaw === undefined || fixedRaw === null || fixedRaw === ""
      ? null
      : Number(fixedRaw);

  if (mode === "percent") {
    if (!Number.isInteger(percent) || percent <= 0 || percent > 100) {
      return { ok: false, error: "bookingPrepaymentPercent inválido (1 a 100)" };
    }
    return {
      ok: true,
      mode,
      percent,
      fixedArs: null,
    };
  }
  if (mode === "fixed") {
    if (!Number.isInteger(fixedArs) || fixedArs <= 0) {
      return { ok: false, error: "bookingPrepaymentFixedArs inválido (> 0)" };
    }
    return {
      ok: true,
      mode,
      percent: null,
      fixedArs,
    };
  }
  return {
    ok: true,
    mode,
    percent: null,
    fixedArs: null,
  };
}

// Público: listado de servicios activos
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, price_ars AS price, duration_min AS durationMin, quote_only AS quoteOnly,
              booking_prepayment_mode AS bookingPrepaymentMode,
              booking_prepayment_percent AS bookingPrepaymentPercent,
              booking_prepayment_fixed_ars AS bookingPrepaymentFixedArs
       FROM services
       WHERE is_active = 1 AND tenant_id = :tenantId
       ORDER BY id`,
      { tenantId: req.tenant.id }
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error leyendo servicios" });
  }
});

router.post("/", auth, requireRole("admin"), async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const quoteOnly = req.body?.quoteOnly ? 1 : 0;
    const rawPrice = req.body?.price;
    const rawDuration = req.body?.durationMin;
    const price = rawPrice === undefined || rawPrice === null || rawPrice === "" ? 0 : Number(rawPrice);
    const durationMin =
      rawDuration === undefined || rawDuration === null || rawDuration === "" ? 0 : Number(rawDuration);

    if (!name) return res.status(400).json({ error: "name requerido" });
    if (!Number.isInteger(price) || price < 0) {
      return res.status(400).json({ error: "price inválido" });
    }
    if (!Number.isInteger(durationMin) || durationMin < 0) {
      return res.status(400).json({ error: "durationMin inválido" });
    }
    if (!quoteOnly && price <= 0) {
      return res.status(400).json({ error: "price inválido" });
    }
    if (!quoteOnly && durationMin <= 0) {
      return res.status(400).json({ error: "durationMin inválido" });
    }
    const prepaymentCfg = normalizePrepaymentConfig(req.body || {});
    if (!prepaymentCfg.ok) {
      return res.status(400).json({ error: prepaymentCfg.error });
    }
    if (quoteOnly && prepaymentCfg.mode !== "none") {
      return res.status(400).json({
        error: "Los servicios de presupuesto no admiten seña online.",
      });
    }
    if (prepaymentCfg.mode === "fixed" && !quoteOnly && prepaymentCfg.fixedArs > price) {
      return res.status(400).json({
        error: "La seña fija no puede superar el precio del servicio.",
      });
    }

    const [ins] = await pool.query(
      `INSERT INTO services
       (tenant_id, name, price_ars, duration_min, quote_only,
        booking_prepayment_mode, booking_prepayment_percent, booking_prepayment_fixed_ars,
        is_active)
       VALUES
       (:tenantId, :name, :price, :durationMin, :quoteOnly,
        :bookingPrepaymentMode, :bookingPrepaymentPercent, :bookingPrepaymentFixedArs,
        1)`,
      {
        tenantId: req.tenant.id,
        name,
        price: quoteOnly ? 0 : price,
        durationMin: quoteOnly ? 0 : durationMin,
        quoteOnly,
        bookingPrepaymentMode: quoteOnly ? "none" : prepaymentCfg.mode,
        bookingPrepaymentPercent: quoteOnly ? null : prepaymentCfg.percent,
        bookingPrepaymentFixedArs: quoteOnly ? null : prepaymentCfg.fixedArs,
      }
    );

    res.status(201).json({ id: ins.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error creando servicio" });
  }
});

router.patch("/:id", auth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id inválido" });

    const [[existingService]] = await pool.query(
      `SELECT id, price_ars, quote_only, booking_prepayment_mode, booking_prepayment_fixed_ars
       FROM services
       WHERE id = :id AND tenant_id = :tenantId
       LIMIT 1`,
      { id, tenantId: req.tenant.id }
    );
    if (!existingService) return res.status(404).json({ error: "Servicio no existe" });

    const updates = [];
    const params = { id, tenantId: req.tenant.id };

    if (req.body?.name !== undefined) {
      updates.push("name = :name");
      params.name = String(req.body.name || "").trim();
    }
    if (req.body?.price !== undefined) {
      const price = Number(req.body.price);
      if (!Number.isInteger(price) || price < 0) {
        return res.status(400).json({ error: "price inválido" });
      }
      updates.push("price_ars = :price");
      params.price = price;
    }
    if (req.body?.durationMin !== undefined) {
      const durationMin = Number(req.body.durationMin);
      if (!Number.isInteger(durationMin) || durationMin <= 0) {
        return res.status(400).json({ error: "durationMin inválido" });
      }
      updates.push("duration_min = :durationMin");
      params.durationMin = durationMin;
    }
    if (req.body?.isActive !== undefined) {
      updates.push("is_active = :isActive");
      params.isActive = req.body.isActive ? 1 : 0;
    }
    if (req.body?.quoteOnly !== undefined) {
      updates.push("quote_only = :quoteOnly");
      params.quoteOnly = req.body.quoteOnly ? 1 : 0;
      if (params.quoteOnly === 1) {
        updates.push("booking_prepayment_mode = :bookingPrepaymentMode");
        updates.push("booking_prepayment_percent = :bookingPrepaymentPercent");
        updates.push("booking_prepayment_fixed_ars = :bookingPrepaymentFixedArs");
        params.bookingPrepaymentMode = "none";
        params.bookingPrepaymentPercent = null;
        params.bookingPrepaymentFixedArs = null;
      }
    }
    if (
      req.body?.bookingPrepaymentMode !== undefined ||
      req.body?.bookingPrepaymentPercent !== undefined ||
      req.body?.bookingPrepaymentFixedArs !== undefined
    ) {
      const cfg = normalizePrepaymentConfig(req.body || {});
      if (!cfg.ok) {
        return res.status(400).json({ error: cfg.error });
      }
      updates.push("booking_prepayment_mode = :bookingPrepaymentMode");
      updates.push("booking_prepayment_percent = :bookingPrepaymentPercent");
      updates.push("booking_prepayment_fixed_ars = :bookingPrepaymentFixedArs");
      params.bookingPrepaymentMode = cfg.mode;
      params.bookingPrepaymentPercent = cfg.percent;
      params.bookingPrepaymentFixedArs = cfg.fixedArs;
    }

    if (!updates.length) return res.status(400).json({ error: "Sin cambios" });

    if (
      params.quoteOnly === 1 &&
      (params.bookingPrepaymentMode === "total" ||
        params.bookingPrepaymentMode === "percent" ||
        params.bookingPrepaymentMode === "fixed")
    ) {
      return res.status(400).json({
        error: "Los servicios de presupuesto no admiten seña online.",
      });
    }

    const effectiveMode =
      params.bookingPrepaymentMode !== undefined
        ? params.bookingPrepaymentMode
        : String(existingService.booking_prepayment_mode || "none");
    const effectivePrice =
      params.price !== undefined ? Number(params.price) : Number(existingService.price_ars || 0);
    const effectiveQuoteOnly =
      params.quoteOnly !== undefined ? Number(params.quoteOnly) : Number(existingService.quote_only || 0);
    const effectiveFixedArs =
      params.bookingPrepaymentFixedArs !== undefined
        ? params.bookingPrepaymentFixedArs
        : Number(existingService.booking_prepayment_fixed_ars || 0);
    if (effectiveMode === "fixed" && !effectiveQuoteOnly && Number(effectiveFixedArs || 0) > effectivePrice) {
      return res.status(400).json({
        error: "La seña fija no puede superar el precio del servicio.",
      });
    }

    const [result] = await pool.query(
      `UPDATE services
       SET ${updates.join(", ")}
       WHERE id = :id AND tenant_id = :tenantId`,
      params
    );

    if (!result.affectedRows) return res.status(404).json({ error: "Servicio no existe" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error actualizando servicio" });
  }
});

router.delete("/:id", auth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id inválido" });

    const [result] = await pool.query(
      `UPDATE services
       SET is_active = 0
       WHERE id = :id AND tenant_id = :tenantId`,
      { id, tenantId: req.tenant.id }
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Servicio no existe" });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error desactivando servicio" });
  }
});

module.exports = router;

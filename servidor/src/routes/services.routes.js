const express = require("express");
const { pool } = require("../db");
const { auth } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");

const router = express.Router();

// Público: listado de servicios activos
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, price_ars AS price, duration_min AS durationMin
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
    const price = Number(req.body?.price);
    const durationMin = Number(req.body?.durationMin);

    if (!name) return res.status(400).json({ error: "name requerido" });
    if (!Number.isInteger(price) || price <= 0) {
      return res.status(400).json({ error: "price inválido" });
    }
    if (!Number.isInteger(durationMin) || durationMin <= 0) {
      return res.status(400).json({ error: "durationMin inválido" });
    }

    const [ins] = await pool.query(
      `INSERT INTO services (tenant_id, name, price_ars, duration_min, is_active)
       VALUES (:tenantId, :name, :price, :durationMin, 1)`,
      { tenantId: req.tenant.id, name, price, durationMin }
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

    const updates = [];
    const params = { id, tenantId: req.tenant.id };

    if (req.body?.name !== undefined) {
      updates.push("name = :name");
      params.name = String(req.body.name || "").trim();
    }
    if (req.body?.price !== undefined) {
      const price = Number(req.body.price);
      if (!Number.isInteger(price) || price <= 0) {
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

    if (!updates.length) return res.status(400).json({ error: "Sin cambios" });

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

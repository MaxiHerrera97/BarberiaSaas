const express = require("express");
const { pool } = require("../db");
const { auth } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");

const router = express.Router();

function isMultiBranchEnabled(req) {
  return Number(req.tenant?.multi_branch_enabled || 0) === 1;
}

// Público: listado de barberos activos
router.get("/", async (req, res) => {
  try {
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    if (req.query.branchId !== undefined && (!Number.isInteger(branchId) || branchId <= 0)) {
      return res.status(400).json({ error: "branchId inválido" });
    }

    let sql = `SELECT id, branch_id AS branchId, full_name AS name, commission_pct AS commissionPct, 'Barbero' AS role
       FROM barbers
       WHERE is_active = 1 AND tenant_id = :tenantId`;
    const params = { tenantId: req.tenant.id };
    if (branchId) {
      sql += " AND branch_id = :branchId";
      params.branchId = branchId;
    }
    sql += " ORDER BY id";

    const [rows] = await pool.query(
      sql,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error leyendo barberos" });
  }
});

router.post("/", auth, requireRole("admin"), async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const commissionPctRaw = Number(req.body?.commissionPct ?? 0);
    const commissionPct = Number.isFinite(commissionPctRaw)
      ? Math.min(Math.max(commissionPctRaw, 0), 100)
      : 0;
    let branchId = req.body?.branchId === undefined ? null : Number(req.body?.branchId);
    if (!name) return res.status(400).json({ error: "name requerido" });

    if (branchId !== null && (!Number.isInteger(branchId) || branchId <= 0)) {
      return res.status(400).json({ error: "branchId inválido" });
    }

    if (!isMultiBranchEnabled(req)) {
      branchId = null;
    }

    if (branchId === null) {
      const [[defaultBranch]] = await pool.query(
        `SELECT id
         FROM branches
         WHERE tenant_id = :tenantId AND is_active = 1
         ORDER BY id ASC
         LIMIT 1`,
        { tenantId: req.tenant.id }
      );
      if (!defaultBranch) return res.status(400).json({ error: "No hay sucursal activa" });
      branchId = defaultBranch.id;
    } else {
      const [[branch]] = await pool.query(
        `SELECT id
         FROM branches
         WHERE id = :branchId AND tenant_id = :tenantId
         LIMIT 1`,
        { branchId, tenantId: req.tenant.id }
      );
      if (!branch) return res.status(400).json({ error: "branchId no existe en este tenant" });
    }

    const [ins] = await pool.query(
      `INSERT INTO barbers (tenant_id, branch_id, full_name, commission_pct, is_active)
       VALUES (:tenantId, :branchId, :name, :commissionPct, 1)`,
      { tenantId: req.tenant.id, branchId, name, commissionPct }
    );

    try {
      await pool.query(
        `INSERT INTO barber_business_hours
         (tenant_id, barber_id, day_of_week, is_closed, open1, close1, open2, close2, open3, close3, open4, close4, open5, close5)
         SELECT
           :tenantId,
           :barberId,
           h.day_of_week,
           h.is_closed,
           h.open1,
           h.close1,
           h.open2,
           h.close2,
           h.open3,
           h.close3,
           h.open4,
           h.close4,
           h.open5,
           h.close5
         FROM business_hours h
         WHERE h.tenant_id = :tenantId
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
        { tenantId: req.tenant.id, barberId: ins.insertId }
      );
    } catch (e) {
      if (e?.code !== "ER_NO_SUCH_TABLE") throw e;
    }

    res.status(201).json({ id: ins.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error creando barbero" });
  }
});

router.patch("/:id", auth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id inválido" });

    const updates = [];
    const params = { id, tenantId: req.tenant.id };

    if (req.body?.name !== undefined) {
      updates.push("full_name = :name");
      params.name = String(req.body.name || "").trim();
    }
    if (req.body?.isActive !== undefined) {
      updates.push("is_active = :isActive");
      params.isActive = req.body.isActive ? 1 : 0;
    }
    if (req.body?.branchId !== undefined) {
      if (!isMultiBranchEnabled(req)) {
        return res.status(403).json({
          error: "Multi-sucursal deshabilitado para este tenant",
        });
      }
      const branchId = Number(req.body.branchId);
      if (!Number.isInteger(branchId) || branchId <= 0) {
        return res.status(400).json({ error: "branchId inválido" });
      }
      const [[branch]] = await pool.query(
        `SELECT id
         FROM branches
         WHERE id = :branchId AND tenant_id = :tenantId
         LIMIT 1`,
        { branchId, tenantId: req.tenant.id }
      );
      if (!branch) return res.status(400).json({ error: "branchId no existe en este tenant" });
      updates.push("branch_id = :branchId");
      params.branchId = branchId;
    }
    if (req.body?.commissionPct !== undefined) {
      const commissionPct = Number(req.body.commissionPct);
      if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 100) {
        return res.status(400).json({ error: "commissionPct inválido (0 a 100)" });
      }
      updates.push("commission_pct = :commissionPct");
      params.commissionPct = commissionPct;
    }

    if (!updates.length) return res.status(400).json({ error: "Sin cambios" });

    const [result] = await pool.query(
      `UPDATE barbers
       SET ${updates.join(", ")}
       WHERE id = :id AND tenant_id = :tenantId`,
      params
    );

    if (!result.affectedRows) return res.status(404).json({ error: "Barbero no existe" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error actualizando barbero" });
  }
});

router.delete("/:id", auth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id inválido" });

    const [result] = await pool.query(
      `UPDATE barbers
       SET is_active = 0
       WHERE id = :id AND tenant_id = :tenantId`,
      { id, tenantId: req.tenant.id }
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Barbero no existe" });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error desactivando barbero" });
  }
});

module.exports = router;

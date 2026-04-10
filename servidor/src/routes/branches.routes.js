const express = require("express");
const { pool } = require("../db");
const { auth } = require("../middleware/auth");
const { requireRole } = require("../middleware/role");

const router = express.Router();

function isMultiBranchEnabled(req) {
  return Number(req.tenant?.multi_branch_enabled || 0) === 1;
}

function slugifyBranch(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function buildUniqueBranchSlug(tenantId, baseSlug) {
  const safeBase = slugifyBranch(baseSlug);
  if (!safeBase || !/^[a-z0-9-]{2,80}$/.test(safeBase)) return "";

  const [rows] = await pool.query(
    `SELECT slug
     FROM branches
     WHERE tenant_id = :tenantId AND slug LIKE :slugLike`,
    { tenantId, slugLike: `${safeBase}%` }
  );
  const used = new Set(rows.map((r) => String(r.slug || "").toLowerCase()));
  if (!used.has(safeBase)) return safeBase;

  for (let i = 2; i <= 9999; i += 1) {
    const suffix = `-${i}`;
    const next = `${safeBase}${suffix}`.slice(0, 80);
    if (!used.has(next)) return next;
  }
  return "";
}

router.get("/", async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === "1";
    const onlyPrincipalWhenDisabled = !isMultiBranchEnabled(req);
    const [rows] = await pool.query(
      `SELECT id, name, slug, is_active
       FROM branches
       WHERE tenant_id = :tenantId
         ${includeInactive ? "" : "AND is_active = 1"}
         ${onlyPrincipalWhenDisabled ? "AND slug = 'principal'" : ""}
       ORDER BY is_active DESC, id ASC`,
      { tenantId: req.tenant.id }
    );
    return res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        isActive: !!r.is_active,
      }))
    );
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error leyendo sucursales" });
  }
});

router.post("/", auth, requireRole("admin"), async (req, res) => {
  try {
    if (!isMultiBranchEnabled(req)) {
      return res.status(403).json({
        error: "Multi-sucursal deshabilitado para este tenant",
      });
    }

    const name = String(req.body?.name || "").trim().slice(0, 120);
    const slugInput = String(req.body?.slug || "").trim().toLowerCase().slice(0, 80);
    if (!name) return res.status(400).json({ error: "name requerido" });

    let slug = slugifyBranch(slugInput || name);
    if (!slug || !/^[a-z0-9-]{2,80}$/.test(slug)) {
      return res.status(400).json({ error: "slug inválido (2-80, a-z0-9 y guiones)" });
    }
    slug = await buildUniqueBranchSlug(req.tenant.id, slug);
    if (!slug) {
      return res.status(400).json({ error: "No se pudo generar un slug único para la sucursal" });
    }

    const [ins] = await pool.query(
      `INSERT INTO branches (tenant_id, name, slug, is_active)
       VALUES (:tenantId, :name, :slug, 1)`,
      { tenantId: req.tenant.id, name, slug }
    );
    return res.status(201).json({ id: ins.insertId, slug });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error creando sucursal" });
  }
});

router.patch("/:id", auth, requireRole("admin"), async (req, res) => {
  try {
    if (!isMultiBranchEnabled(req)) {
      return res.status(403).json({
        error: "Multi-sucursal deshabilitado para este tenant",
      });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "id inválido" });

    const updates = [];
    const params = { id, tenantId: req.tenant.id };

    if (req.body?.name !== undefined) {
      params.name = String(req.body.name || "").trim().slice(0, 120);
      updates.push("name = :name");
    }
    if (req.body?.slug !== undefined) {
      const slug = String(req.body.slug || "").trim().toLowerCase().slice(0, 80);
      if (!slug || !/^[a-z0-9-]{2,80}$/.test(slug)) {
        return res.status(400).json({ error: "slug inválido (2-80, a-z0-9 y guiones)" });
      }
      params.slug = slug;
      updates.push("slug = :slug");
    }
    if (req.body?.isActive !== undefined) {
      params.isActive = req.body.isActive ? 1 : 0;
      updates.push("is_active = :isActive");
    }

    if (!updates.length) return res.status(400).json({ error: "Sin cambios" });

    const [upd] = await pool.query(
      `UPDATE branches
       SET ${updates.join(", ")}
       WHERE id = :id AND tenant_id = :tenantId`,
      params
    );
    if (!upd.affectedRows) return res.status(404).json({ error: "Sucursal no existe" });
    return res.json({ ok: true });
  } catch (e) {
    if (e?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Ya existe una sucursal con ese slug en este tenant" });
    }
    console.error(e);
    return res.status(500).json({ error: "Error actualizando sucursal" });
  }
});

router.delete("/:id", auth, requireRole("admin"), async (req, res) => {
  try {
    if (!isMultiBranchEnabled(req)) {
      return res.status(403).json({
        error: "Multi-sucursal deshabilitado para este tenant",
      });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "id inválido" });

    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt
       FROM branches
       WHERE tenant_id = :tenantId AND is_active = 1`,
      { tenantId: req.tenant.id }
    );
    if (Number(countRow?.cnt || 0) <= 1) {
      return res.status(400).json({ error: "Debe existir al menos una sucursal activa" });
    }

    const [upd] = await pool.query(
      `UPDATE branches
       SET is_active = 0
       WHERE id = :id AND tenant_id = :tenantId`,
      { id, tenantId: req.tenant.id }
    );
    if (!upd.affectedRows) return res.status(404).json({ error: "Sucursal no existe" });
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error desactivando sucursal" });
  }
});

router.delete("/:id/permanent", auth, requireRole("admin"), async (req, res) => {
  try {
    if (!isMultiBranchEnabled(req)) {
      return res.status(403).json({
        error: "Multi-sucursal deshabilitado para este tenant",
      });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "id inválido" });

    const [[branch]] = await pool.query(
      `SELECT id, is_active
       FROM branches
       WHERE id = :id AND tenant_id = :tenantId
       LIMIT 1`,
      { id, tenantId: req.tenant.id }
    );
    if (!branch) return res.status(404).json({ error: "Sucursal no existe" });
    if (Number(branch.is_active) === 1) {
      return res.status(400).json({ error: "Primero desactiva la sucursal antes de eliminarla definitivamente" });
    }

    const [[usage]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM barbers b WHERE b.tenant_id = :tenantId AND b.branch_id = :id) AS barbers_cnt,
         (SELECT COUNT(*) FROM users u WHERE u.tenant_id = :tenantId AND u.branch_id = :id) AS users_cnt,
         (SELECT COUNT(*) FROM appointments a WHERE a.tenant_id = :tenantId AND a.branch_id = :id) AS appointments_cnt,
         (SELECT COUNT(*) FROM appointment_holds h WHERE h.tenant_id = :tenantId AND h.branch_id = :id) AS holds_cnt`,
      { id, tenantId: req.tenant.id }
    );

    const hasUsage =
      Number(usage?.barbers_cnt || 0) > 0 ||
      Number(usage?.users_cnt || 0) > 0 ||
      Number(usage?.appointments_cnt || 0) > 0 ||
      Number(usage?.holds_cnt || 0) > 0;

    if (hasUsage) {
      return res.status(409).json({
        error: "No se puede eliminar definitivamente: la sucursal tiene barberos, usuarios o turnos vinculados",
        usage: {
          barbers: Number(usage?.barbers_cnt || 0),
          users: Number(usage?.users_cnt || 0),
          appointments: Number(usage?.appointments_cnt || 0),
          holds: Number(usage?.holds_cnt || 0),
        },
      });
    }

    const [del] = await pool.query(
      `DELETE FROM branches
       WHERE id = :id AND tenant_id = :tenantId`,
      { id, tenantId: req.tenant.id }
    );
    if (!del.affectedRows) return res.status(404).json({ error: "Sucursal no existe" });

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error eliminando sucursal definitivamente" });
  }
});

module.exports = router;

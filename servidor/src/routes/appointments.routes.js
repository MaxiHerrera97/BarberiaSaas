
const express = require("express");
const { pool } = require("../db");
const { auth } = require("../middleware/auth");
const { startEndOfDayLocalSQL, parseMySQLDateTimeLocal } = require("../utils/time");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

console.log("🔥 appointments.routes.js LOADED");

/** Limpieza simple de holds expirados */
async function cleanupExpiredHolds(tenantId) {
  await pool.query(
    `DELETE FROM appointment_holds WHERE expires_at <= NOW() AND tenant_id = :tenantId`,
    { tenantId }
  );
}

async function autoFinalizeElapsedAppointments(tenantId) {
  await pool.query(
    `UPDATE appointments
     SET status = 'done'
     WHERE tenant_id = :tenantId
       AND status = 'in_progress'
       AND end_at <= NOW()`,
    { tenantId }
  );
}

function toMySQLDateOnly(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildDateAtTime(baseDate, timeLike) {
  const str = String(timeLike || "");
  const [hh, mm, ss] = str.split(":").map((x) => Number(x || 0));
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hh || 0,
    mm || 0,
    ss || 0,
    0
  );
}

function dateToHHMM(dateObj) {
  const hh = String(dateObj.getHours()).padStart(2, "0");
  const mm = String(dateObj.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function windowsFromRow(baseDate, row) {
  if (!row || Number(row.is_closed) === 1) return [];
  const out = [];
  if (row.open1 && row.close1) {
    out.push({
      start: buildDateAtTime(baseDate, row.open1),
      end: buildDateAtTime(baseDate, row.close1),
    });
  }
  if (row.open2 && row.close2) {
    out.push({
      start: buildDateAtTime(baseDate, row.open2),
      end: buildDateAtTime(baseDate, row.close2),
    });
  }
  return out.filter((w) => w.end.getTime() > w.start.getTime());
}

async function getBarberOwnWindowsForDate(tenantId, barberId, dateLike) {
  const baseDate = dateLike instanceof Date ? new Date(dateLike) : new Date(dateLike);
  if (Number.isNaN(baseDate.getTime())) return [];
  const dayOfWeek = baseDate.getDay();
  const dateValue = toMySQLDateOnly(baseDate);
  try {
    const [[exceptionRow]] = await pool.query(
      `SELECT is_closed, open1, close1, open2, close2
       FROM barber_schedule_exceptions
       WHERE tenant_id = :tenantId
         AND barber_id = :barberId
         AND date_value = :dateValue
       LIMIT 1`,
      { tenantId, barberId, dateValue }
    );

    if (exceptionRow) return windowsFromRow(baseDate, exceptionRow);

    const [[weeklyRow]] = await pool.query(
      `SELECT is_closed, open1, close1, open2, close2
       FROM barber_business_hours
       WHERE tenant_id = :tenantId
         AND barber_id = :barberId
         AND day_of_week = :dayOfWeek
       LIMIT 1`,
      { tenantId, barberId, dayOfWeek }
    );
    return windowsFromRow(baseDate, weeklyRow);
  } catch (e) {
    if (e?.code === "ER_NO_SUCH_TABLE") {
      console.warn(
        "[barber-hours] Faltan tablas de horarios por barbero. Ejecuta migración 009_barber_schedules.sql"
      );
      return [];
    }
    throw e;
  }
}

async function getEffectiveBarberWindowsForDate(tenantId, barberId, dateLike) {
  if (!barberId) return [];
  return getBarberOwnWindowsForDate(tenantId, barberId, dateLike);
}

async function isWithinBarberAvailability(tenantId, barberId, startAt, endAt) {
  const start = parseMySQLDateTimeLocal(startAt);
  const end = parseMySQLDateTimeLocal(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  if (end.getTime() <= start.getTime()) return false;
  if (start.toDateString() !== end.toDateString()) return false;

  const windows = await getEffectiveBarberWindowsForDate(tenantId, barberId, start);
  if (!windows.length) return false;

  return windows.some((w) => start.getTime() >= w.start.getTime() && end.getTime() <= w.end.getTime());
}

/**
 * GET /appointments/display?date=YYYY-MM-DD
 * PÚBLICO: datos mínimos para pantalla TV (sin teléfono)
 */
router.get("/display", async (req, res) => {
  try {
    await autoFinalizeElapsedAppointments(req.tenant.id);

    const dateStr = req.query.date;
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    if (req.query.branchId !== undefined && (!Number.isInteger(branchId) || branchId <= 0)) {
      return res.status(400).json({ error: "branchId inválido" });
    }
    const range = startEndOfDayLocalSQL(dateStr);
    if (!range) return res.status(400).json({ error: "date inválida (YYYY-MM-DD)" });

    const params = { tenantId: req.tenant.id, start: range.start, end: range.end };
    let where = `tenant_id = :tenantId AND start_at >= :start AND start_at < :end`;
    if (branchId) {
      where += " AND branch_id = :branchId";
      params.branchId = branchId;
    }

    const [rows] = await pool.query(
      `SELECT id, branch_id, barber_id, service_id,
              service_name_snapshot, service_price_ars_snapshot, service_duration_min_snapshot,
              customer_name, start_at, end_at, status
       FROM appointments
       WHERE ${where}
       ORDER BY start_at ASC`,
      params
    );

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error leyendo turnos (display)" });
  }
});

/**
 * GET /appointments?date=YYYY-MM-DD
 * PROTEGIDO: admin ve todos, barber ve solo los suyos
 */
router.get("/", auth, async (req, res) => {
  try {
    await autoFinalizeElapsedAppointments(req.tenant.id);

    const dateStr = req.query.date;
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    if (req.query.branchId !== undefined && (!Number.isInteger(branchId) || branchId <= 0)) {
      return res.status(400).json({ error: "branchId inválido" });
    }
    const range = startEndOfDayLocalSQL(dateStr);
    if (!range) return res.status(400).json({ error: "date inválida (YYYY-MM-DD)" });

    const params = { tenantId: req.tenant.id, start: range.start, end: range.end };

    let sql = `
      SELECT a.id, a.branch_id, a.barber_id, a.service_id, a.customer_name, a.customer_phone,
             a.service_name_snapshot, a.service_price_ars_snapshot, a.service_duration_min_snapshot,
             a.start_at, a.end_at, a.status, a.notes
      FROM appointments a
      WHERE a.tenant_id = :tenantId AND a.start_at >= :start AND a.start_at < :end
    `;

    if (req.user.role === "barber") {
      sql += " AND a.barber_id = :barberId";
      params.barberId = req.user.barberId;
    }
    if (branchId) {
      sql += " AND a.branch_id = :branchId";
      params.branchId = branchId;
    }

    sql += " ORDER BY a.start_at ASC";

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error leyendo turnos" });
  }
});

/**
 * GET /appointments/availability?date=YYYY-MM-DD&barberId=1
 * PÚBLICO: para pintar disponibilidad en el BookingModal
 * Devuelve appointments + holds activos (no vencidos).
 * ✅ Devuelve DATETIME como STRING "YYYY-MM-DD HH:mm:ss" para evitar corrimientos de TZ en el front.
 */
router.get("/availability", async (req, res) => {
  try {
    await autoFinalizeElapsedAppointments(req.tenant.id);

    const dateStr = req.query.date;
    const barberId = req.query.barberId ? Number(req.query.barberId) : null;
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    if (req.query.branchId !== undefined && (!Number.isInteger(branchId) || branchId <= 0)) {
      return res.status(400).json({ error: "branchId inválido" });
    }

    const range = startEndOfDayLocalSQL(dateStr);
    if (!range) return res.status(400).json({ error: "date inválida (YYYY-MM-DD)" });

    const params = { tenantId: req.tenant.id, start: range.start, end: range.end };
    let whereAppt = `WHERE tenant_id = :tenantId AND start_at >= :start AND start_at < :end`;
    let whereHold =
      `WHERE tenant_id = :tenantId AND start_at >= :start AND start_at < :end AND expires_at > NOW()`;

    if (barberId) {
      whereAppt += " AND barber_id = :barberId";
      whereHold += " AND barber_id = :barberId";
      params.barberId = barberId;
    }
    if (branchId) {
      whereAppt += " AND branch_id = :branchId";
      whereHold += " AND branch_id = :branchId";
      params.branchId = branchId;
    }

    const [appts] = await pool.query(
      `SELECT id, branch_id, barber_id, service_id,
              service_name_snapshot, service_price_ars_snapshot, service_duration_min_snapshot,
              DATE_FORMAT(start_at, '%Y-%m-%d %H:%i:%s') AS start_at,
              DATE_FORMAT(end_at,   '%Y-%m-%d %H:%i:%s') AS end_at,
              status
       FROM appointments
       ${whereAppt}`,
      params
    );

    const [holds] = await pool.query(
      `SELECT id, branch_id, barber_id, service_id,
              DATE_FORMAT(start_at,   '%Y-%m-%d %H:%i:%s') AS start_at,
              DATE_FORMAT(end_at,     '%Y-%m-%d %H:%i:%s') AS end_at,
              DATE_FORMAT(expires_at, '%Y-%m-%d %H:%i:%s') AS expires_at
       FROM appointment_holds
       ${whereHold}`,
      params
    );

    const effectiveWindows = barberId
      ? await getEffectiveBarberWindowsForDate(req.tenant.id, barberId, `${dateStr} 00:00:00`)
      : [];

    res.json({
      appointments: appts,
      holds,
      dayWindows: effectiveWindows.map((w) => ({
        start: dateToHHMM(w.start),
        end: dateToHHMM(w.end),
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error leyendo disponibilidad" });
  }
});

/**
 * GET /appointments/barber-calendar?barberId=1&from=YYYY-MM-DD&days=14
 * PÚBLICO: días disponibles de un barbero (intersección barbería + barbero)
 */
router.get("/barber-calendar", async (req, res) => {
  try {
    const barberId = Number(req.query?.barberId);
    const days = Math.min(Math.max(Number(req.query?.days) || 14, 1), 31);
    const fromRaw = String(req.query?.from || "").trim();
    if (!Number.isInteger(barberId) || barberId <= 0) {
      return res.status(400).json({ error: "barberId inválido" });
    }

    const [[barber]] = await pool.query(
      `SELECT id
       FROM barbers
       WHERE id = :barberId AND tenant_id = :tenantId AND is_active = 1
       LIMIT 1`,
      { barberId, tenantId: req.tenant.id }
    );
    if (!barber) {
      return res.status(400).json({ error: "Barbero inválido para este tenant" });
    }

    const fromDate = fromRaw ? new Date(`${fromRaw}T00:00:00`) : new Date();
    if (Number.isNaN(fromDate.getTime())) {
      return res.status(400).json({ error: "from inválido (YYYY-MM-DD)" });
    }
    fromDate.setHours(0, 0, 0, 0);

    const availableDates = [];
    const windowsByDate = {};

    for (let i = 0; i < days; i += 1) {
      const d = new Date(fromDate);
      d.setDate(fromDate.getDate() + i);
      const dateKey = toMySQLDateOnly(d);
      const windows = await getEffectiveBarberWindowsForDate(req.tenant.id, barberId, d);
      if (windows.length) {
        availableDates.push(dateKey);
        windowsByDate[dateKey] = windows.map((w) => ({
          start: dateToHHMM(w.start),
          end: dateToHHMM(w.end),
        }));
      }
    }

    return res.json({
      barberId,
      from: toMySQLDateOnly(fromDate),
      days,
      availableDates,
      windowsByDate,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error calculando calendario de barbero" });
  }
});

/**
 * POST /appointments/hold
 * PÚBLICO
 * ✅ Ahora valida horario de atención y domingo cerrado.
 */
router.post("/hold", async (req, res) => {
  console.log("🔥 POST /appointments/hold", req.body);

  try {
    await cleanupExpiredHolds(req.tenant.id);

    const { branchId, barberId, serviceId, startAt, endAt } = req.body || {};
    if (!barberId || !serviceId || !startAt || !endAt) {
      return res.status(400).json({ error: "Datos incompletos" });
    }
    const branchIdNum =
      branchId === undefined || branchId === null || branchId === ""
        ? null
        : Number(branchId);
    if (branchId !== undefined && (!Number.isInteger(branchIdNum) || branchIdNum <= 0)) {
      return res.status(400).json({ error: "branchId inválido" });
    }

    const [barberRows] = await pool.query(
      `SELECT id, branch_id
       FROM barbers
       WHERE id = :barberId AND tenant_id = :tenantId LIMIT 1`,
      { barberId, tenantId: req.tenant.id }
    );
    if (!barberRows.length) {
      return res.status(400).json({ error: "Barbero inválido para este tenant" });
    }

    // ✅ VALIDACIÓN HORARIOS (barbero + barbería)
    if (!(await isWithinBarberAvailability(req.tenant.id, barberId, startAt, endAt))) {
      return res.status(400).json({
        error:
          "Fuera del horario disponible del barbero.",
      });
    }
    const barberBranchId = Number(barberRows[0].branch_id || 0);
    if (branchIdNum && barberBranchId !== branchIdNum) {
      return res.status(400).json({ error: "Ese barbero no pertenece a la sucursal elegida" });
    }
    const finalBranchId = branchIdNum || barberBranchId || null;
    if (!finalBranchId) {
      return res.status(400).json({ error: "No se pudo resolver la sucursal del turno" });
    }

    const [serviceRows] = await pool.query(
      `SELECT id FROM services WHERE id = :serviceId AND tenant_id = :tenantId LIMIT 1`,
      { serviceId, tenantId: req.tenant.id }
    );
    if (!serviceRows.length) {
      return res.status(400).json({ error: "Servicio inválido para este tenant" });
    }

    const holdToken = uuidv4();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // turno existente
      const [appts] = await conn.query(
        `SELECT id FROM appointments
         WHERE tenant_id = :tenantId AND barber_id = :barberId AND start_at = :startAt
         LIMIT 1`,
        { tenantId: req.tenant.id, barberId, startAt }
      );
      if (appts.length) {
        await conn.rollback();
        return res.status(409).json({ error: "Slot ocupado" });
      }

      // hold existente
      const [holds] = await conn.query(
        `SELECT id FROM appointment_holds
         WHERE tenant_id = :tenantId AND barber_id = :barberId
           AND start_at = :startAt AND expires_at > NOW()
         LIMIT 1`,
        { tenantId: req.tenant.id, barberId, startAt }
      );
      if (holds.length) {
        await conn.rollback();
        return res.status(409).json({ error: "Slot en proceso" });
      }

      await conn.query(
        `INSERT INTO appointment_holds
         (tenant_id, branch_id, barber_id, service_id, start_at, end_at, hold_token, expires_at)
         VALUES
         (:tenantId, :branchId, :barberId, :serviceId, :startAt, :endAt, :holdToken, DATE_ADD(NOW(), INTERVAL 3 MINUTE))`,
        { tenantId: req.tenant.id, branchId: finalBranchId, barberId, serviceId, startAt, endAt, holdToken }
      );

      await conn.commit();
      res.json({ holdToken, expiresInSec: 180 });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error creando hold" });
  }
});

/**
 * DELETE /appointments/hold/:token
 */
router.delete("/hold/:token", async (req, res) => {
  await pool.query(
    `DELETE FROM appointment_holds WHERE hold_token = :token AND tenant_id = :tenantId`,
    {
      token: req.params.token,
      tenantId: req.tenant.id,
    }
  );
  res.json({ ok: true });
});

/**
 * POST /appointments/confirm
 * PÚBLICO
 * ✅ Defensa extra: revalida horario también.
 * ✅ Teléfono obligatorio AR (10 dígitos, solo números)
 */
router.post("/confirm", async (req, res) => {
  try {
    const { holdToken, customerName, customerPhone } = req.body || {};

    const phoneDigits = String(customerPhone || "").replace(/\D/g, "");

    if (!holdToken || !customerName || !phoneDigits) {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    if (!/^\d{10}$/.test(phoneDigits)) {
      return res.status(400).json({
        error: "Teléfono inválido. Usá 10 dígitos, ejemplo: 3813686226",
      });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [holds] = await conn.query(
        `SELECT *
         FROM appointment_holds
         WHERE hold_token = :holdToken AND tenant_id = :tenantId AND expires_at > NOW()
         LIMIT 1`,
        { holdToken, tenantId: req.tenant.id }
      );

      if (!holds.length) {
        await conn.rollback();
        return res.status(410).json({ error: "Hold expiró" });
      }

      const h = holds[0];

      const [[service]] = await conn.query(
        `SELECT id, name, price_ars, duration_min
         FROM services
         WHERE id = :serviceId
           AND tenant_id = :tenantId
         LIMIT 1`,
        { serviceId: h.service_id, tenantId: req.tenant.id }
      );
      if (!service) {
        await conn.rollback();
        return res.status(400).json({ error: "Servicio inválido para este tenant" });
      }

      const [[barber]] = await conn.query(
        `SELECT id, commission_pct
         FROM barbers
         WHERE id = :barberId
           AND tenant_id = :tenantId
         LIMIT 1`,
        { barberId: h.barber_id, tenantId: req.tenant.id }
      );
      if (!barber) {
        await conn.rollback();
        return res.status(400).json({ error: "Barbero inválido para este tenant" });
      }
      const commissionPct = Number(barber.commission_pct || 0);
      const commissionArs = Math.round((Number(service.price_ars || 0) * commissionPct) / 100);

      // ✅ VALIDACIÓN HORARIOS (defensa)
      if (!(await isWithinBarberAvailability(req.tenant.id, h.barber_id, h.start_at, h.end_at))) {
        await conn.rollback();
        return res.status(400).json({
          error:
            "Ese horario no está dentro del horario disponible del barbero. Volvé a elegir uno válido.",
        });
      }

      const [ins] = await conn.query(
        `INSERT INTO appointments
         (tenant_id, branch_id, barber_id, service_id,
          service_name_snapshot, service_price_ars_snapshot, service_duration_min_snapshot,
          barber_commission_pct_snapshot, barber_commission_ars_snapshot,
          customer_name, customer_phone, start_at, end_at, status)
         VALUES
         (:tenantId, :branchId, :barberId, :serviceId,
          :serviceNameSnapshot, :servicePriceSnapshot, :serviceDurationSnapshot,
          :barberCommissionPctSnapshot, :barberCommissionArsSnapshot,
          :customerName, :customerPhone, :startAt, :endAt, 'pending')`,
        {
          tenantId: req.tenant.id,
          branchId: h.branch_id,
          barberId: h.barber_id,
          serviceId: h.service_id,
          serviceNameSnapshot: String(service.name || "").trim().slice(0, 120) || null,
          servicePriceSnapshot: Number(service.price_ars || 0) || null,
          serviceDurationSnapshot: Number(service.duration_min || 0) || null,
          barberCommissionPctSnapshot: commissionPct,
          barberCommissionArsSnapshot: commissionArs,
          customerName: String(customerName).trim(),
          customerPhone: phoneDigits, // ✅ guardamos normalizado
          startAt: h.start_at,
          endAt: h.end_at,
        }
      );

      await conn.query(
        `DELETE FROM appointment_holds WHERE id = :id AND tenant_id = :tenantId`,
        { id: h.id, tenantId: req.tenant.id }
      );

      await conn.commit();
      res.json({ appointmentId: ins.insertId });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error confirmando turno" });
  }
});

/**
 * PATCH /appointments/:id/status
 * PROTEGIDO
 * Body: { status }
 * - admin puede cambiar cualquier turno
 * - barber sólo puede cambiar turnos propios
 */
router.patch("/:id/status", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body || {};

    const allowed = new Set(["pending", "in_progress", "done", "no_show", "cancelled"]);
    if (!id || !allowed.has(status)) {
      return res.status(400).json({ error: "status inválido" });
    }

    const [rows] = await pool.query(
      `SELECT id, barber_id FROM appointments
       WHERE id = :id AND tenant_id = :tenantId
       LIMIT 1`,
      { id, tenantId: req.tenant.id }
    );
    if (!rows.length) return res.status(404).json({ error: "Turno no existe" });

    const appt = rows[0];

    if (req.user.role === "barber") {
      if (!req.user.barberId) return res.status(403).json({ error: "Barbero no asociado" });
      if (Number(appt.barber_id) !== Number(req.user.barberId)) {
        return res.status(403).json({ error: "No autorizado" });
      }
    }

    await pool.query(
      `UPDATE appointments
       SET status = :status
       WHERE id = :id AND tenant_id = :tenantId`,
      {
      id,
      status,
      tenantId: req.tenant.id,
      }
    );

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error actualizando estado" });
  }
});

/**
 * GET /appointments/ranking?year=2026&month=1
 * PROTEGIDO: solo admin
 * Ranking mensual por barbero (status 'done') + detalle de clientes/servicios + historial mensual
 */
router.get("/ranking", auth, async (req, res) => {
  try {
    await autoFinalizeElapsedAppointments(req.tenant.id);

    const role = String(req.user?.role || "").trim().toLowerCase();
    if (!["admin", "barber"].includes(role)) {
      return res.status(403).json({ error: "No autorizado" });
    }
    if (role === "barber" && !req.user?.barberId) {
      return res.status(403).json({ error: "Barbero no asociado" });
    }

    const year = Number(req.query.year);
    const month = Number(req.query.month); // 1..12
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    if (req.query.branchId !== undefined && (!Number.isInteger(branchId) || branchId <= 0)) {
      return res.status(400).json({ error: "branchId inválido" });
    }

    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: "Parámetros inválidos (year, month)" });
    }

    const pad2 = (n) => String(n).padStart(2, "0");
    const start = `${year}-${pad2(month)}-01 00:00:00`;

    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const end = `${nextYear}-${pad2(nextMonth)}-01 00:00:00`;

    const barberFilter =
      role === "barber" ? " AND a.barber_id = :barberId " : "";
    const branchFilter = branchId ? " AND a.branch_id = :branchId " : "";
    const queryParams = {
      tenantId: req.tenant.id,
      start,
      end,
      ...(branchId ? { branchId } : {}),
      ...(role === "barber" ? { barberId: Number(req.user.barberId) } : {}),
    };

    // 1) Ranking por barbero (cortes finalizados + facturación estimada)
    const [rankRows] = await pool.query(
      `
      SELECT 
        a.barber_id,
        COALESCE(b.full_name, CONCAT('Barbero ', a.barber_id)) AS barber_name,
        COUNT(*) AS cuts,
        COALESCE(SUM(COALESCE(a.service_price_ars_snapshot, s.price_ars)), 0) AS revenue_ars,
        COALESCE(SUM(
          COALESCE(
            a.barber_commission_ars_snapshot,
            ROUND(COALESCE(a.service_price_ars_snapshot, s.price_ars) * COALESCE(b.commission_pct, 0) / 100)
          )
        ), 0) AS commission_ars
      FROM appointments a
      LEFT JOIN barbers b ON b.id = a.barber_id
      LEFT JOIN services s ON s.id = a.service_id
      WHERE a.tenant_id = :tenantId
        AND a.status = 'done'
        AND a.start_at >= :start
        AND a.start_at < :end
        ${barberFilter}
        ${branchFilter}
      GROUP BY a.barber_id, b.full_name
      ORDER BY cuts DESC, barber_name ASC
      `,
      queryParams
    );

    // 2) Detalle: clientes que vinieron (done) por barbero + cantidad de veces
    // Agrupamos por barber + phone (más confiable que el nombre)
    // y elegimos el último nombre registrado en el mes para mostrarlo prolijo.
    const [clientRows] = await pool.query(
      `
      SELECT 
        a.barber_id,
        COALESCE(b.full_name, CONCAT('Barbero ', a.barber_id)) AS barber_name,
        a.customer_phone,
        SUBSTRING_INDEX(
          GROUP_CONCAT(a.customer_name ORDER BY a.start_at DESC SEPARATOR '||'),
          '||', 1
        ) AS customer_name,
        COUNT(*) AS visits
      FROM appointments a
      LEFT JOIN barbers b ON b.id = a.barber_id
      WHERE a.tenant_id = :tenantId
        AND a.status = 'done'
        AND a.start_at >= :start
        AND a.start_at < :end
        ${barberFilter}
        ${branchFilter}
        AND a.customer_phone IS NOT NULL
        AND a.customer_phone <> ''
      GROUP BY a.barber_id, b.full_name, a.customer_phone
      ORDER BY a.barber_id ASC, visits DESC, customer_name ASC
      `,
      queryParams
    );

    // 3) Detalle de servicios finalizados por barbero (cantidad + facturación)
    const [serviceRows] = await pool.query(
      `
      SELECT
        a.barber_id,
        COALESCE(b.full_name, CONCAT('Barbero ', a.barber_id)) AS barber_name,
        a.service_id,
        COALESCE(MAX(a.service_name_snapshot), s.name, CONCAT('Servicio ', a.service_id)) AS service_name,
        COUNT(*) AS qty,
        COALESCE(SUM(COALESCE(a.service_price_ars_snapshot, s.price_ars)), 0) AS revenue_ars,
        COALESCE(SUM(
          COALESCE(
            a.barber_commission_ars_snapshot,
            ROUND(COALESCE(a.service_price_ars_snapshot, s.price_ars) * COALESCE(b.commission_pct, 0) / 100)
          )
        ), 0) AS commission_ars
      FROM appointments a
      LEFT JOIN barbers b ON b.id = a.barber_id
      LEFT JOIN services s ON s.id = a.service_id
      WHERE a.tenant_id = :tenantId
        AND a.status = 'done'
        AND a.start_at >= :start
        AND a.start_at < :end
        ${barberFilter}
        ${branchFilter}
      GROUP BY a.barber_id, b.full_name, a.service_id, s.name
      ORDER BY a.barber_id ASC, qty DESC, service_name ASC
      `,
      queryParams
    );

    const servicesByBarber = {};
    for (const r of serviceRows) {
      const key = String(r.barber_id);
      if (!servicesByBarber[key]) servicesByBarber[key] = [];
      servicesByBarber[key].push({
        service_id: Number(r.service_id),
        service_name: r.service_name,
        qty: Number(r.qty) || 0,
        revenue_ars: Number(r.revenue_ars) || 0,
        commission_ars: Number(r.commission_ars) || 0,
      });
    }

    // 4) Historial mensual (últimos 6 meses desde el mes seleccionado)
    const history = [];
    for (let i = 5; i >= 0; i -= 1) {
      const startDate = new Date(year, month - 1 - i, 1);
      const endDate = new Date(year, month - i, 1);
      const hStart = `${startDate.getFullYear()}-${pad2(startDate.getMonth() + 1)}-01 00:00:00`;
      const hEnd = `${endDate.getFullYear()}-${pad2(endDate.getMonth() + 1)}-01 00:00:00`;

      const [histRows] = await pool.query(
        `
        SELECT
          COUNT(*) AS cuts,
          COALESCE(SUM(COALESCE(a.service_price_ars_snapshot, s.price_ars)), 0) AS revenue_ars,
          COALESCE(SUM(
            COALESCE(
              a.barber_commission_ars_snapshot,
              ROUND(COALESCE(a.service_price_ars_snapshot, s.price_ars) * COALESCE(b.commission_pct, 0) / 100)
            )
          ), 0) AS commission_ars
        FROM appointments a
        LEFT JOIN barbers b ON b.id = a.barber_id
        LEFT JOIN services s ON s.id = a.service_id
        WHERE a.tenant_id = :tenantId
          AND a.status = 'done'
          AND a.start_at >= :start
          AND a.start_at < :end
          ${barberFilter}
          ${branchFilter}
        `,
        {
          ...queryParams,
          start: hStart,
          end: hEnd,
        }
      );

      const row = Array.isArray(histRows) && histRows[0] ? histRows[0] : {};
      history.push({
        year: startDate.getFullYear(),
        month: startDate.getMonth() + 1,
        cuts: Number(row.cuts) || 0,
        revenue_ars: Number(row.revenue_ars) || 0,
        commission_ars: Number(row.commission_ars) || 0,
      });
    }

    const totalCuts = rankRows.reduce((acc, r) => acc + (Number(r.cuts) || 0), 0);
    const totalRevenueArs = rankRows.reduce((acc, r) => acc + (Number(r.revenue_ars) || 0), 0);
    const totalCommissionArs = rankRows.reduce((acc, r) => acc + (Number(r.commission_ars) || 0), 0);

    // armamos un mapa barber_id -> clientes[]
    const clientsByBarber = {};
    for (const r of clientRows) {
      const key = String(r.barber_id);
      if (!clientsByBarber[key]) clientsByBarber[key] = [];
      clientsByBarber[key].push({
        customer_phone: r.customer_phone,
        customer_name: r.customer_name,
        visits: Number(r.visits) || 0,
      });
    }

    res.json({
      year,
      month,
      start,
      end,
      summary: {
        cuts: totalCuts,
        revenue_ars: totalRevenueArs,
        commission_ars: totalCommissionArs,
      },
      ranking: rankRows.map((r) => ({
        barber_id: r.barber_id,
        barber_name: r.barber_name,
        cuts: Number(r.cuts) || 0,
        revenue_ars: Number(r.revenue_ars) || 0,
        commission_ars: Number(r.commission_ars) || 0,
      })),
      clientsByBarber, // ✅ NUEVO
      servicesByBarber,
      history,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error generando ranking" });
  }
});

module.exports = router;

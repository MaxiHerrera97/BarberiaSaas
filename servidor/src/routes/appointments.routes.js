
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

function buildMonthRange(year, month) {
  const pad2 = (n) => String(n).padStart(2, "0");
  const start = `${year}-${pad2(month)}-01 00:00:00`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = `${nextYear}-${pad2(nextMonth)}-01 00:00:00`;
  return {
    start,
    end,
    label: `${year}-${pad2(month)}`,
  };
}

function formatDateTimeInTimezone(dateLike, timezone) {
  if (!dateLike) return "";

  let dateObj = null;
  if (dateLike instanceof Date) {
    dateObj = dateLike;
  } else {
    const raw = String(dateLike || "").trim();
    if (!raw) return "";
    const parsed = raw.includes("T")
      ? new Date(raw.endsWith("Z") ? raw : `${raw}Z`)
      : new Date(raw.replace(" ", "T") + "Z");
    if (!Number.isNaN(parsed.getTime())) dateObj = parsed;
  }
  if (!dateObj || Number.isNaN(dateObj.getTime())) return String(dateLike);

  return new Intl.DateTimeFormat("es-AR", {
    timeZone: timezone || "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(dateObj);
}

function toMySQLDateTimeLocal(dateLike) {
  const d = dateLike instanceof Date ? new Date(dateLike) : new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function addMinutesToMySQLDateTimeLocal(startAt, minutes) {
  const base = parseMySQLDateTimeLocal(startAt);
  if (Number.isNaN(base.getTime())) return "";
  const mins = Number(minutes);
  if (!Number.isFinite(mins) || mins <= 0) return "";
  base.setMinutes(base.getMinutes() + mins);
  return toMySQLDateTimeLocal(base);
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
  if (row.open3 && row.close3) {
    out.push({
      start: buildDateAtTime(baseDate, row.open3),
      end: buildDateAtTime(baseDate, row.close3),
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
      `SELECT is_closed, open1, close1, open2, close2, open3, close3
       FROM barber_schedule_exceptions
       WHERE tenant_id = :tenantId
         AND barber_id = :barberId
         AND date_value = :dateValue
       LIMIT 1`,
      { tenantId, barberId, dateValue }
    );

    if (exceptionRow) return windowsFromRow(baseDate, exceptionRow);

    const [[weeklyRow]] = await pool.query(
      `SELECT is_closed, open1, close1, open2, close2, open3, close3
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
    let whereAppt =
      `WHERE tenant_id = :tenantId AND start_at >= :start AND start_at < :end AND status IN ('pending','in_progress')`;
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

    const { branchId, barberId, serviceId, startAt } = req.body || {};
    if (!barberId || !serviceId || !startAt) {
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

    const [serviceRows] = await pool.query(
      `SELECT id, duration_min, quote_only FROM services WHERE id = :serviceId AND tenant_id = :tenantId LIMIT 1`,
      { serviceId, tenantId: req.tenant.id }
    );
    if (!serviceRows.length) {
      return res.status(400).json({ error: "Servicio inválido para este tenant" });
    }
    if (Number(serviceRows[0].quote_only || 0) === 1) {
      return res.status(400).json({
        error: "Este servicio se gestiona por presupuesto. Pedí cotización por WhatsApp.",
      });
    }
    const serviceDurationMin = Number(serviceRows[0].duration_min || 0);
    if (!Number.isInteger(serviceDurationMin) || serviceDurationMin <= 0) {
      return res.status(400).json({ error: "La duración del servicio es inválida" });
    }
    const computedEndAt = addMinutesToMySQLDateTimeLocal(startAt, serviceDurationMin);
    if (!computedEndAt) {
      return res.status(400).json({ error: "startAt inválido" });
    }

    // ✅ VALIDACIÓN HORARIOS (barbero + barbería)
    if (!(await isWithinBarberAvailability(req.tenant.id, barberId, startAt, computedEndAt))) {
      return res.status(400).json({
        error: "Fuera del horario disponible del barbero.",
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

    const holdToken = uuidv4();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // turno existente
      const [appts] = await conn.query(
        `SELECT id FROM appointments
         WHERE tenant_id = :tenantId
           AND barber_id = :barberId
           AND status IN ('pending','in_progress')
           AND start_at < :endAt
           AND end_at > :startAt
         LIMIT 1`,
        { tenantId: req.tenant.id, barberId, startAt, endAt: computedEndAt }
      );
      if (appts.length) {
        await conn.rollback();
        return res.status(409).json({ error: "Horario ocupado" });
      }

      // hold existente
      const [holds] = await conn.query(
        `SELECT id FROM appointment_holds
         WHERE tenant_id = :tenantId AND barber_id = :barberId
           AND start_at < :endAt
           AND end_at > :startAt
           AND expires_at > NOW()
         LIMIT 1`,
        { tenantId: req.tenant.id, barberId, startAt, endAt: computedEndAt }
      );
      if (holds.length) {
        await conn.rollback();
        return res.status(409).json({ error: "Horario en proceso de reserva" });
      }

      await conn.query(
        `INSERT INTO appointment_holds
         (tenant_id, branch_id, barber_id, service_id, start_at, end_at, hold_token, expires_at)
         VALUES
         (:tenantId, :branchId, :barberId, :serviceId, :startAt, :endAt, :holdToken, DATE_ADD(NOW(), INTERVAL 3 MINUTE))`,
        {
          tenantId: req.tenant.id,
          branchId: finalBranchId,
          barberId,
          serviceId,
          startAt,
          endAt: computedEndAt,
          holdToken,
        }
      );

      await conn.commit();
      res.json({ holdToken, expiresInSec: 180, startAt, endAt: computedEndAt });
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
         LIMIT 1
         FOR UPDATE`,
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

      const [overlapAppts] = await conn.query(
        `SELECT id
         FROM appointments
         WHERE tenant_id = :tenantId
           AND barber_id = :barberId
           AND status IN ('pending','in_progress')
           AND start_at < :endAt
           AND end_at > :startAt
         LIMIT 1`,
        {
          tenantId: req.tenant.id,
          barberId: h.barber_id,
          startAt: h.start_at,
          endAt: h.end_at,
        }
      );
      if (overlapAppts.length) {
        await conn.rollback();
        return res.status(409).json({ error: "Ese horario ya no está disponible" });
      }

      const [overlapHolds] = await conn.query(
        `SELECT id
         FROM appointment_holds
         WHERE tenant_id = :tenantId
           AND barber_id = :barberId
           AND hold_token <> :holdToken
           AND expires_at > NOW()
           AND start_at < :endAt
           AND end_at > :startAt
         LIMIT 1`,
        {
          tenantId: req.tenant.id,
          barberId: h.barber_id,
          holdToken,
          startAt: h.start_at,
          endAt: h.end_at,
        }
      );
      if (overlapHolds.length) {
        await conn.rollback();
        return res.status(409).json({ error: "Ese horario está en proceso de reserva" });
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

    // 5) Top clientes del mes (global tenant/branch; para barber se restringe a su barber_id)
    const [topClientsRows] = await pool.query(
      `
      SELECT
        a.customer_phone,
        SUBSTRING_INDEX(
          GROUP_CONCAT(a.customer_name ORDER BY a.start_at DESC SEPARATOR '||'),
          '||', 1
        ) AS customer_name,
        COUNT(*) AS visits,
        COALESCE(SUM(COALESCE(a.service_price_ars_snapshot, s.price_ars)), 0) AS spent_ars
      FROM appointments a
      LEFT JOIN services s ON s.id = a.service_id
      WHERE a.tenant_id = :tenantId
        AND a.status = 'done'
        AND a.start_at >= :start
        AND a.start_at < :end
        ${barberFilter}
        ${branchFilter}
        AND a.customer_phone IS NOT NULL
        AND a.customer_phone <> ''
      GROUP BY a.customer_phone
      ORDER BY visits DESC, spent_ars DESC, customer_name ASC
      LIMIT 20
      `,
      queryParams
    );

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
      topClients: topClientsRows.map((r) => ({
        customer_phone: r.customer_phone,
        customer_name: r.customer_name,
        visits: Number(r.visits) || 0,
        spent_ars: Number(r.spent_ars) || 0,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error generando ranking" });
  }
});

/**
 * GET /appointments/cash-summary?date=YYYY-MM-DD&year=2026&month=4&branchId=1
 * PROTEGIDO: admin y barber
 * Resumen de caja diaria y mensual basado en turnos finalizados.
 */
router.get("/cash-summary", auth, async (req, res) => {
  try {
    await autoFinalizeElapsedAppointments(req.tenant.id);

    const role = String(req.user?.role || "").trim().toLowerCase();
    if (!["admin", "barber"].includes(role)) {
      return res.status(403).json({ error: "No autorizado" });
    }
    if (role === "barber" && !req.user?.barberId) {
      return res.status(403).json({ error: "Barbero no asociado" });
    }

    const dateStr = String(req.query?.date || "").trim();
    const dayRange = startEndOfDayLocalSQL(dateStr);
    if (!dayRange) return res.status(400).json({ error: "date inválida (YYYY-MM-DD)" });

    const parsedDate = parseMySQLDateTimeLocal(`${dateStr} 00:00:00`);
    const qYear = Number(req.query?.year) || parsedDate.getFullYear();
    const qMonth = Number(req.query?.month) || parsedDate.getMonth() + 1;
    if (!qYear || !qMonth || qMonth < 1 || qMonth > 12) {
      return res.status(400).json({ error: "Parámetros inválidos (year, month)" });
    }
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    if (req.query.branchId !== undefined && (!Number.isInteger(branchId) || branchId <= 0)) {
      return res.status(400).json({ error: "branchId inválido" });
    }

    const monthRange = buildMonthRange(qYear, qMonth);

    const barberFilter = role === "barber" ? " AND a.barber_id = :barberId " : "";
    const branchFilter = branchId ? " AND a.branch_id = :branchId " : "";
    const baseParams = {
      tenantId: req.tenant.id,
      ...(branchId ? { branchId } : {}),
      ...(role === "barber" ? { barberId: Number(req.user.barberId) } : {}),
    };

    const [dayRows] = await pool.query(
      `
      SELECT
        COUNT(*) AS services_done,
        COALESCE(SUM(COALESCE(a.service_price_ars_snapshot, s.price_ars)), 0) AS revenue_ars,
        COALESCE(SUM(
          COALESCE(
            a.barber_commission_ars_snapshot,
            ROUND(COALESCE(a.service_price_ars_snapshot, s.price_ars) * COALESCE(b.commission_pct, 0) / 100)
          )
        ), 0) AS commission_ars
      FROM appointments a
      LEFT JOIN services s ON s.id = a.service_id
      LEFT JOIN barbers b ON b.id = a.barber_id
      WHERE a.tenant_id = :tenantId
        AND a.status = 'done'
        AND a.start_at >= :start
        AND a.start_at < :end
        ${barberFilter}
        ${branchFilter}
      `,
      {
        ...baseParams,
        start: dayRange.start,
        end: dayRange.end,
      }
    );

    const [monthRows] = await pool.query(
      `
      SELECT
        COUNT(*) AS services_done,
        COALESCE(SUM(COALESCE(a.service_price_ars_snapshot, s.price_ars)), 0) AS revenue_ars,
        COALESCE(SUM(
          COALESCE(
            a.barber_commission_ars_snapshot,
            ROUND(COALESCE(a.service_price_ars_snapshot, s.price_ars) * COALESCE(b.commission_pct, 0) / 100)
          )
        ), 0) AS commission_ars
      FROM appointments a
      LEFT JOIN services s ON s.id = a.service_id
      LEFT JOIN barbers b ON b.id = a.barber_id
      WHERE a.tenant_id = :tenantId
        AND a.status = 'done'
        AND a.start_at >= :start
        AND a.start_at < :end
        ${barberFilter}
        ${branchFilter}
      `,
      {
        ...baseParams,
        start: monthRange.start,
        end: monthRange.end,
      }
    );

    const [monthByBarberRows] = await pool.query(
      `
      SELECT
        a.barber_id,
        COALESCE(b.full_name, CONCAT('Barbero ', a.barber_id)) AS barber_name,
        COUNT(*) AS services_done,
        COALESCE(SUM(COALESCE(a.service_price_ars_snapshot, s.price_ars)), 0) AS revenue_ars,
        COALESCE(SUM(
          COALESCE(
            a.barber_commission_ars_snapshot,
            ROUND(COALESCE(a.service_price_ars_snapshot, s.price_ars) * COALESCE(b.commission_pct, 0) / 100)
          )
        ), 0) AS commission_ars
      FROM appointments a
      LEFT JOIN services s ON s.id = a.service_id
      LEFT JOIN barbers b ON b.id = a.barber_id
      WHERE a.tenant_id = :tenantId
        AND a.status = 'done'
        AND a.start_at >= :start
        AND a.start_at < :end
        ${barberFilter}
        ${branchFilter}
      GROUP BY a.barber_id, b.full_name
      ORDER BY revenue_ars DESC, services_done DESC, barber_name ASC
      `,
      {
        ...baseParams,
        start: monthRange.start,
        end: monthRange.end,
      }
    );

    const [monthByServiceRows] = await pool.query(
      `
      SELECT
        a.service_id,
        COALESCE(MAX(a.service_name_snapshot), s.name, CONCAT('Servicio ', a.service_id)) AS service_name,
        COUNT(*) AS services_done,
        COALESCE(SUM(COALESCE(a.service_price_ars_snapshot, s.price_ars)), 0) AS revenue_ars
      FROM appointments a
      LEFT JOIN services s ON s.id = a.service_id
      WHERE a.tenant_id = :tenantId
        AND a.status = 'done'
        AND a.start_at >= :start
        AND a.start_at < :end
        ${barberFilter}
        ${branchFilter}
      GROUP BY a.service_id, s.name
      ORDER BY revenue_ars DESC, services_done DESC, service_name ASC
      LIMIT 10
      `,
      {
        ...baseParams,
        start: monthRange.start,
        end: monthRange.end,
      }
    );

    const [dayByBarberRows] = await pool.query(
      `
      SELECT
        a.barber_id,
        COALESCE(b.full_name, CONCAT('Barbero ', a.barber_id)) AS barber_name,
        COUNT(*) AS services_done,
        COALESCE(SUM(COALESCE(a.service_price_ars_snapshot, s.price_ars)), 0) AS revenue_ars,
        COALESCE(SUM(
          COALESCE(
            a.barber_commission_ars_snapshot,
            ROUND(COALESCE(a.service_price_ars_snapshot, s.price_ars) * COALESCE(b.commission_pct, 0) / 100)
          )
        ), 0) AS commission_ars
      FROM appointments a
      LEFT JOIN services s ON s.id = a.service_id
      LEFT JOIN barbers b ON b.id = a.barber_id
      WHERE a.tenant_id = :tenantId
        AND a.status = 'done'
        AND a.start_at >= :start
        AND a.start_at < :end
        ${barberFilter}
        ${branchFilter}
      GROUP BY a.barber_id, b.full_name
      ORDER BY revenue_ars DESC, services_done DESC, barber_name ASC
      `,
      {
        ...baseParams,
        start: dayRange.start,
        end: dayRange.end,
      }
    );

    const [dayByServiceRows] = await pool.query(
      `
      SELECT
        a.service_id,
        COALESCE(MAX(a.service_name_snapshot), s.name, CONCAT('Servicio ', a.service_id)) AS service_name,
        COUNT(*) AS services_done,
        COALESCE(SUM(COALESCE(a.service_price_ars_snapshot, s.price_ars)), 0) AS revenue_ars
      FROM appointments a
      LEFT JOIN services s ON s.id = a.service_id
      WHERE a.tenant_id = :tenantId
        AND a.status = 'done'
        AND a.start_at >= :start
        AND a.start_at < :end
        ${barberFilter}
        ${branchFilter}
      GROUP BY a.service_id, s.name
      ORDER BY revenue_ars DESC, services_done DESC, service_name ASC
      LIMIT 10
      `,
      {
        ...baseParams,
        start: dayRange.start,
        end: dayRange.end,
      }
    );

    const day = dayRows?.[0] || {};
    const month = monthRows?.[0] || {};

    const branchScopeId = branchId || 0;
    let closing = {
      isClosed: false,
      closureDate: dateStr,
      branchScopeId,
      closedAt: null,
      closedByUser: null,
      snapshot: null,
    };
    try {
      const [closingRows] = await pool.query(
        `SELECT c.id, c.closed_at, c.services_done, c.revenue_ars, c.commission_ars,
                c.by_barber_json, c.by_service_json,
                u.id AS closed_by_user_id, u.full_name AS closed_by_name
         FROM tenant_cash_closures c
         LEFT JOIN users u ON u.id = c.closed_by_user_id
         WHERE c.tenant_id = :tenantId
           AND c.closure_date = :closureDate
           AND c.branch_scope_id = :branchScopeId
         LIMIT 1`,
        {
          tenantId: req.tenant.id,
          closureDate: dateStr,
          branchScopeId,
        }
      );
      if (closingRows.length) {
        const row = closingRows[0];
        let byBarberSnapshot = [];
        let byServiceSnapshot = [];
        try {
          byBarberSnapshot =
            typeof row.by_barber_json === "string"
              ? JSON.parse(row.by_barber_json || "[]")
              : row.by_barber_json || [];
          byServiceSnapshot =
            typeof row.by_service_json === "string"
              ? JSON.parse(row.by_service_json || "[]")
              : row.by_service_json || [];
        } catch {
          byBarberSnapshot = [];
          byServiceSnapshot = [];
        }
        closing = {
          isClosed: true,
          closureDate: dateStr,
          branchScopeId,
          closedAt: row.closed_at || null,
          closedAtDisplay: formatDateTimeInTimezone(row.closed_at, req.tenant?.timezone),
          closedByUser: row.closed_by_user_id
            ? {
                id: Number(row.closed_by_user_id),
                name: row.closed_by_name || "Usuario",
              }
            : null,
          snapshot: {
            daily: {
              services_done: Number(row.services_done) || 0,
              revenue_ars: Number(row.revenue_ars) || 0,
              commission_ars: Number(row.commission_ars) || 0,
            },
            byBarber: byBarberSnapshot,
            byService: byServiceSnapshot,
          },
        };
      }
    } catch (e) {
      if (e?.code !== "ER_NO_SUCH_TABLE") throw e;
    }

    return res.json({
      date: dateStr,
      month: monthRange.label,
      daily: {
        services_done: Number(day.services_done) || 0,
        revenue_ars: Number(day.revenue_ars) || 0,
        commission_ars: Number(day.commission_ars) || 0,
      },
      monthly: {
        services_done: Number(month.services_done) || 0,
        revenue_ars: Number(month.revenue_ars) || 0,
        commission_ars: Number(month.commission_ars) || 0,
      },
      byBarberDay: dayByBarberRows.map((r) => ({
        barber_id: Number(r.barber_id),
        barber_name: r.barber_name,
        services_done: Number(r.services_done) || 0,
        revenue_ars: Number(r.revenue_ars) || 0,
        commission_ars: Number(r.commission_ars) || 0,
      })),
      byServiceDay: dayByServiceRows.map((r) => ({
        service_id: Number(r.service_id),
        service_name: r.service_name,
        services_done: Number(r.services_done) || 0,
        revenue_ars: Number(r.revenue_ars) || 0,
      })),
      byBarberMonth: monthByBarberRows.map((r) => ({
        barber_id: Number(r.barber_id),
        barber_name: r.barber_name,
        services_done: Number(r.services_done) || 0,
        revenue_ars: Number(r.revenue_ars) || 0,
        commission_ars: Number(r.commission_ars) || 0,
      })),
      byServiceMonth: monthByServiceRows.map((r) => ({
        service_id: Number(r.service_id),
        service_name: r.service_name,
        services_done: Number(r.services_done) || 0,
        revenue_ars: Number(r.revenue_ars) || 0,
      })),
      closing,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error generando resumen de caja" });
  }
});

/**
 * POST /appointments/cash-close-day
 * PROTEGIDO: solo admin
 * Crea o reescribe (force) el cierre de caja diario.
 */
router.post("/cash-close-day", auth, async (req, res) => {
  try {
    if (String(req.user?.role || "").trim().toLowerCase() !== "admin") {
      return res.status(403).json({ error: "Solo admin puede cerrar caja" });
    }

    const dateStr = String(req.body?.date || "").trim();
    const dayRange = startEndOfDayLocalSQL(dateStr);
    if (!dayRange) return res.status(400).json({ error: "date inválida (YYYY-MM-DD)" });

    const branchId = req.body?.branchId ? Number(req.body.branchId) : null;
    if (req.body?.branchId !== undefined && (!Number.isInteger(branchId) || branchId <= 0)) {
      return res.status(400).json({ error: "branchId inválido" });
    }
    const force = Boolean(req.body?.force);
    const branchScopeId = branchId || 0;

    const [dayRows] = await pool.query(
      `
      SELECT
        COUNT(*) AS services_done,
        COALESCE(SUM(COALESCE(a.service_price_ars_snapshot, s.price_ars)), 0) AS revenue_ars,
        COALESCE(SUM(
          COALESCE(
            a.barber_commission_ars_snapshot,
            ROUND(COALESCE(a.service_price_ars_snapshot, s.price_ars) * COALESCE(b.commission_pct, 0) / 100)
          )
        ), 0) AS commission_ars
      FROM appointments a
      LEFT JOIN services s ON s.id = a.service_id
      LEFT JOIN barbers b ON b.id = a.barber_id
      WHERE a.tenant_id = :tenantId
        AND a.status = 'done'
        AND a.start_at >= :start
        AND a.start_at < :end
        ${branchId ? " AND a.branch_id = :branchId " : ""}
      `,
      {
        tenantId: req.tenant.id,
        start: dayRange.start,
        end: dayRange.end,
        ...(branchId ? { branchId } : {}),
      }
    );

    const [dayByBarberRows] = await pool.query(
      `
      SELECT
        a.barber_id,
        COALESCE(b.full_name, CONCAT('Barbero ', a.barber_id)) AS barber_name,
        COUNT(*) AS services_done,
        COALESCE(SUM(COALESCE(a.service_price_ars_snapshot, s.price_ars)), 0) AS revenue_ars,
        COALESCE(SUM(
          COALESCE(
            a.barber_commission_ars_snapshot,
            ROUND(COALESCE(a.service_price_ars_snapshot, s.price_ars) * COALESCE(b.commission_pct, 0) / 100)
          )
        ), 0) AS commission_ars
      FROM appointments a
      LEFT JOIN services s ON s.id = a.service_id
      LEFT JOIN barbers b ON b.id = a.barber_id
      WHERE a.tenant_id = :tenantId
        AND a.status = 'done'
        AND a.start_at >= :start
        AND a.start_at < :end
        ${branchId ? " AND a.branch_id = :branchId " : ""}
      GROUP BY a.barber_id, b.full_name
      ORDER BY revenue_ars DESC, services_done DESC, barber_name ASC
      `,
      {
        tenantId: req.tenant.id,
        start: dayRange.start,
        end: dayRange.end,
        ...(branchId ? { branchId } : {}),
      }
    );

    const [dayByServiceRows] = await pool.query(
      `
      SELECT
        a.service_id,
        COALESCE(MAX(a.service_name_snapshot), s.name, CONCAT('Servicio ', a.service_id)) AS service_name,
        COUNT(*) AS services_done,
        COALESCE(SUM(COALESCE(a.service_price_ars_snapshot, s.price_ars)), 0) AS revenue_ars
      FROM appointments a
      LEFT JOIN services s ON s.id = a.service_id
      WHERE a.tenant_id = :tenantId
        AND a.status = 'done'
        AND a.start_at >= :start
        AND a.start_at < :end
        ${branchId ? " AND a.branch_id = :branchId " : ""}
      GROUP BY a.service_id, s.name
      ORDER BY revenue_ars DESC, services_done DESC, service_name ASC
      LIMIT 20
      `,
      {
        tenantId: req.tenant.id,
        start: dayRange.start,
        end: dayRange.end,
        ...(branchId ? { branchId } : {}),
      }
    );

    const totals = dayRows?.[0] || {};
    const totalDone = Number(totals.services_done) || 0;
    if (totalDone <= 0) {
      return res.status(400).json({
        error: "No hay servicios finalizados para cerrar caja en la fecha elegida.",
        code: "CASH_EMPTY_DAY",
      });
    }
    const byBarber = dayByBarberRows.map((r) => ({
      barber_id: Number(r.barber_id),
      barber_name: r.barber_name,
      services_done: Number(r.services_done) || 0,
      revenue_ars: Number(r.revenue_ars) || 0,
      commission_ars: Number(r.commission_ars) || 0,
    }));
    const byService = dayByServiceRows.map((r) => ({
      service_id: Number(r.service_id),
      service_name: r.service_name,
      services_done: Number(r.services_done) || 0,
      revenue_ars: Number(r.revenue_ars) || 0,
    }));

    try {
      const [existing] = await pool.query(
        `SELECT id
         FROM tenant_cash_closures
         WHERE tenant_id = :tenantId
           AND closure_date = :closureDate
           AND branch_scope_id = :branchScopeId
         LIMIT 1`,
        {
          tenantId: req.tenant.id,
          closureDate: dateStr,
          branchScopeId,
        }
      );

      if (existing.length && !force) {
        return res.status(409).json({
          error: "La caja de ese día ya está cerrada. Usa force=true para recalcular.",
          code: "CASH_ALREADY_CLOSED",
        });
      }

      await pool.query(
        `INSERT INTO tenant_cash_closures
         (tenant_id, branch_scope_id, branch_id, closure_date,
          services_done, revenue_ars, commission_ars,
          by_barber_json, by_service_json, closed_by_user_id, notes)
         VALUES
         (:tenantId, :branchScopeId, :branchId, :closureDate,
          :servicesDone, :revenueArs, :commissionArs,
          :byBarberJson, :byServiceJson, :closedByUserId, :notes)
         ON DUPLICATE KEY UPDATE
          services_done = VALUES(services_done),
          revenue_ars = VALUES(revenue_ars),
          commission_ars = VALUES(commission_ars),
          by_barber_json = VALUES(by_barber_json),
          by_service_json = VALUES(by_service_json),
          closed_by_user_id = VALUES(closed_by_user_id),
          notes = VALUES(notes),
          closed_at = CURRENT_TIMESTAMP`,
        {
          tenantId: req.tenant.id,
          branchScopeId,
          branchId: branchId || null,
          closureDate: dateStr,
          servicesDone: Number(totals.services_done) || 0,
          revenueArs: Number(totals.revenue_ars) || 0,
          commissionArs: Number(totals.commission_ars) || 0,
          byBarberJson: JSON.stringify(byBarber),
          byServiceJson: JSON.stringify(byService),
          closedByUserId: Number(req.user?.userId || 0) || null,
          notes: "Cierre diario desde panel admin",
        }
      );
    } catch (e) {
      if (e?.code === "ER_NO_SUCH_TABLE") {
        return res.status(500).json({
          error: "Falta tabla tenant_cash_closures. Ejecuta la migración 015.",
        });
      }
      throw e;
    }

    return res.json({
      ok: true,
      closureDate: dateStr,
      branchScopeId,
      totals: {
        services_done: totalDone,
        revenue_ars: Number(totals.revenue_ars) || 0,
        commission_ars: Number(totals.commission_ars) || 0,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error cerrando caja del día" });
  }
});

/**
 * POST /appointments/cash-reopen-day
 * PROTEGIDO: solo admin
 * Reabre una caja cerrada (elimina snapshot) y exige motivo.
 */
router.post("/cash-reopen-day", auth, async (req, res) => {
  try {
    if (String(req.user?.role || "").trim().toLowerCase() !== "admin") {
      return res.status(403).json({ error: "Solo admin puede reabrir caja" });
    }

    const dateStr = String(req.body?.date || "").trim();
    const dayRange = startEndOfDayLocalSQL(dateStr);
    if (!dayRange) return res.status(400).json({ error: "date inválida (YYYY-MM-DD)" });

    const branchId = req.body?.branchId ? Number(req.body.branchId) : null;
    if (req.body?.branchId !== undefined && (!Number.isInteger(branchId) || branchId <= 0)) {
      return res.status(400).json({ error: "branchId inválido" });
    }
    const reason = String(req.body?.reason || "").trim();
    if (reason.length < 5) {
      return res.status(400).json({
        error: "Debes indicar un motivo de al menos 5 caracteres para reabrir la caja.",
      });
    }

    const branchScopeId = branchId || 0;
    let deleted = 0;
    try {
      const [del] = await pool.query(
        `DELETE FROM tenant_cash_closures
         WHERE tenant_id = :tenantId
           AND closure_date = :closureDate
           AND branch_scope_id = :branchScopeId`,
        {
          tenantId: req.tenant.id,
          closureDate: dateStr,
          branchScopeId,
        }
      );
      deleted = Number(del?.affectedRows || 0);
    } catch (e) {
      if (e?.code === "ER_NO_SUCH_TABLE") {
        return res.status(500).json({
          error: "Falta tabla tenant_cash_closures. Ejecuta la migración 015.",
        });
      }
      throw e;
    }

    if (!deleted) {
      return res.status(404).json({
        error: "No existe un cierre de caja para esa fecha/sucursal.",
      });
    }

    console.info("[cash-reopen-day]", {
      tenantId: req.tenant.id,
      userId: req.user?.userId || null,
      branchScopeId,
      date: dateStr,
      reason,
    });

    return res.json({
      ok: true,
      reopened: true,
      closureDate: dateStr,
      branchScopeId,
      reason,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error reabriendo caja del día" });
  }
});

/**
 * GET /appointments/commissions-summary?year=2026&month=4&branchId=1
 * PROTEGIDO: solo admin
 * Resumen de comisiones del mes por barbero + estado de liquidación.
 */
router.get("/commissions-summary", auth, async (req, res) => {
  try {
    if (String(req.user?.role || "").trim().toLowerCase() !== "admin") {
      return res.status(403).json({ error: "Solo admin puede ver comisiones liquidables" });
    }

    const now = new Date();
    const qYear = Number(req.query?.year) || now.getFullYear();
    const qMonth = Number(req.query?.month) || now.getMonth() + 1;
    if (!qYear || !qMonth || qMonth < 1 || qMonth > 12) {
      return res.status(400).json({ error: "Parámetros inválidos (year, month)" });
    }
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    if (req.query.branchId !== undefined && (!Number.isInteger(branchId) || branchId <= 0)) {
      return res.status(400).json({ error: "branchId inválido" });
    }

    const monthRange = buildMonthRange(qYear, qMonth);
    const branchFilter = branchId ? " AND a.branch_id = :branchId " : "";
    const branchScopeId = branchId || 0;
    const params = {
      tenantId: req.tenant.id,
      start: monthRange.start,
      end: monthRange.end,
      ...(branchId ? { branchId } : {}),
    };

    const [rows] = await pool.query(
      `
      SELECT
        a.barber_id,
        COALESCE(b.full_name, CONCAT('Barbero ', a.barber_id)) AS barber_name,
        COUNT(*) AS services_done,
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
        ${branchFilter}
      GROUP BY a.barber_id, b.full_name
      ORDER BY commission_ars DESC, services_done DESC, barber_name ASC
      `,
      params
    );

    let settlementsByBarber = {};
    try {
      const [settlements] = await pool.query(
        `
        SELECT barber_id, status, settled_at, paid_by_user_id, notes
        FROM tenant_commission_settlements
        WHERE tenant_id = :tenantId
          AND settlement_month = :settlementMonth
          AND branch_scope_id = :branchScopeId
        `,
        {
          tenantId: req.tenant.id,
          settlementMonth: monthRange.label,
          branchScopeId,
        }
      );
      settlementsByBarber = Object.fromEntries(
        settlements.map((s) => [
          Number(s.barber_id),
          {
            status: String(s.status || "").toLowerCase() || "pending",
            settled_at: s.settled_at || null,
            paid_by_user_id: s.paid_by_user_id || null,
            notes: s.notes || "",
          },
        ])
      );
    } catch (e) {
      if (e?.code !== "ER_NO_SUCH_TABLE") throw e;
    }

    const items = rows.map((r) => {
      const barberId = Number(r.barber_id);
      const settlement = settlementsByBarber[barberId] || null;
      return {
        barber_id: barberId,
        barber_name: r.barber_name,
        services_done: Number(r.services_done) || 0,
        revenue_ars: Number(r.revenue_ars) || 0,
        commission_ars: Number(r.commission_ars) || 0,
        settlement: {
          status: settlement?.status || "pending",
          settled_at: settlement?.settled_at || null,
          settled_at_display: settlement?.settled_at
            ? formatDateTimeInTimezone(settlement.settled_at, req.tenant?.timezone)
            : "",
          notes: settlement?.notes || "",
        },
      };
    });

    const totals = items.reduce(
      (acc, item) => {
        acc.services_done += Number(item.services_done) || 0;
        acc.revenue_ars += Number(item.revenue_ars) || 0;
        acc.commission_ars += Number(item.commission_ars) || 0;
        if (item.settlement?.status === "settled") {
          acc.settled_commission_ars += Number(item.commission_ars) || 0;
        }
        return acc;
      },
      {
        services_done: 0,
        revenue_ars: 0,
        commission_ars: 0,
        settled_commission_ars: 0,
      }
    );

    return res.json({
      month: monthRange.label,
      branchScopeId,
      totals: {
        ...totals,
        pending_commission_ars:
          Number(totals.commission_ars) - Number(totals.settled_commission_ars),
      },
      items,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error generando resumen de comisiones" });
  }
});

/**
 * POST /appointments/commissions/:barberId/settle
 * PROTEGIDO: solo admin
 * Marca comisión como liquidada para el mes.
 */
router.post("/commissions/:barberId/settle", auth, async (req, res) => {
  try {
    if (String(req.user?.role || "").trim().toLowerCase() !== "admin") {
      return res.status(403).json({ error: "Solo admin puede liquidar comisiones" });
    }

    const barberId = Number(req.params.barberId);
    if (!Number.isInteger(barberId) || barberId <= 0) {
      return res.status(400).json({ error: "barberId inválido" });
    }

    const qYear = Number(req.body?.year);
    const qMonth = Number(req.body?.month);
    if (!qYear || !qMonth || qMonth < 1 || qMonth > 12) {
      return res.status(400).json({ error: "Parámetros inválidos (year, month)" });
    }

    const branchId = req.body?.branchId ? Number(req.body.branchId) : null;
    if (req.body?.branchId !== undefined && (!Number.isInteger(branchId) || branchId <= 0)) {
      return res.status(400).json({ error: "branchId inválido" });
    }
    const branchScopeId = branchId || 0;
    const monthRange = buildMonthRange(qYear, qMonth);
    const branchFilter = branchId ? " AND a.branch_id = :branchId " : "";

    const [rows] = await pool.query(
      `
      SELECT
        COALESCE(SUM(
          COALESCE(
            a.barber_commission_ars_snapshot,
            ROUND(COALESCE(a.service_price_ars_snapshot, s.price_ars) * COALESCE(b.commission_pct, 0) / 100)
          )
        ), 0) AS commission_ars
      FROM appointments a
      LEFT JOIN services s ON s.id = a.service_id
      LEFT JOIN barbers b ON b.id = a.barber_id
      WHERE a.tenant_id = :tenantId
        AND a.barber_id = :barberId
        AND a.status = 'done'
        AND a.start_at >= :start
        AND a.start_at < :end
        ${branchFilter}
      `,
      {
        tenantId: req.tenant.id,
        barberId,
        start: monthRange.start,
        end: monthRange.end,
        ...(branchId ? { branchId } : {}),
      }
    );

    const commissionArs = Number(rows?.[0]?.commission_ars || 0);
    if (commissionArs <= 0) {
      return res.status(400).json({
        error: "No hay comisión pendiente para liquidar en ese período.",
      });
    }

    try {
      await pool.query(
        `
        INSERT INTO tenant_commission_settlements
        (tenant_id, branch_scope_id, branch_id, barber_id, settlement_month, amount_ars, status, settled_at, paid_by_user_id, notes)
        VALUES
        (:tenantId, :branchScopeId, :branchId, :barberId, :settlementMonth, :amountArs, 'settled', UTC_TIMESTAMP(), :paidByUserId, :notes)
        ON DUPLICATE KEY UPDATE
          amount_ars = VALUES(amount_ars),
          status = 'settled',
          settled_at = UTC_TIMESTAMP(),
          paid_by_user_id = VALUES(paid_by_user_id),
          notes = VALUES(notes)
        `,
        {
          tenantId: req.tenant.id,
          branchScopeId,
          branchId: branchId || null,
          barberId,
          settlementMonth: monthRange.label,
          amountArs: commissionArs,
          paidByUserId: Number(req.user?.userId || 0) || null,
          notes: String(req.body?.notes || "Liquidado desde panel admin").slice(0, 255),
        }
      );
    } catch (e) {
      if (e?.code === "ER_NO_SUCH_TABLE") {
        return res.status(500).json({
          error: "Falta tabla tenant_commission_settlements. Ejecuta la migración 016.",
        });
      }
      throw e;
    }

    return res.json({
      ok: true,
      barberId,
      month: monthRange.label,
      amount_ars: commissionArs,
      status: "settled",
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error liquidando comisión" });
  }
});

/**
 * POST /appointments/commissions/:barberId/reopen
 * PROTEGIDO: solo admin
 * Reabre liquidación (vuelve a pendiente) para el mes.
 */
router.post("/commissions/:barberId/reopen", auth, async (req, res) => {
  try {
    if (String(req.user?.role || "").trim().toLowerCase() !== "admin") {
      return res.status(403).json({ error: "Solo admin puede reabrir comisiones" });
    }

    const barberId = Number(req.params.barberId);
    if (!Number.isInteger(barberId) || barberId <= 0) {
      return res.status(400).json({ error: "barberId inválido" });
    }

    const qYear = Number(req.body?.year);
    const qMonth = Number(req.body?.month);
    if (!qYear || !qMonth || qMonth < 1 || qMonth > 12) {
      return res.status(400).json({ error: "Parámetros inválidos (year, month)" });
    }

    const branchId = req.body?.branchId ? Number(req.body.branchId) : null;
    if (req.body?.branchId !== undefined && (!Number.isInteger(branchId) || branchId <= 0)) {
      return res.status(400).json({ error: "branchId inválido" });
    }
    const branchScopeId = branchId || 0;
    const monthRange = buildMonthRange(qYear, qMonth);

    try {
      await pool.query(
        `
        DELETE FROM tenant_commission_settlements
        WHERE tenant_id = :tenantId
          AND barber_id = :barberId
          AND settlement_month = :settlementMonth
          AND branch_scope_id = :branchScopeId
        `,
        {
          tenantId: req.tenant.id,
          barberId,
          settlementMonth: monthRange.label,
          branchScopeId,
        }
      );
    } catch (e) {
      if (e?.code === "ER_NO_SUCH_TABLE") {
        return res.status(500).json({
          error: "Falta tabla tenant_commission_settlements. Ejecuta la migración 016.",
        });
      }
      throw e;
    }

    return res.json({
      ok: true,
      barberId,
      month: monthRange.label,
      status: "pending",
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error reabriendo comisión" });
  }
});

module.exports = router;

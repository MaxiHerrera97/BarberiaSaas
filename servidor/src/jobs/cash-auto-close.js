const { pool } = require("../db");
const { startEndOfDayLocalSQL } = require("../utils/time");

const TICK_MS = 60 * 1000;
let timer = null;
let running = false;
const lastRunByTenantDay = new Map();

function getDateTimePartsInTimezone(dateLike, timezone) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value || "";
  const month = parts.find((p) => p.type === "month")?.value || "";
  const day = parts.find((p) => p.type === "day")?.value || "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value || "0");
  if (!year || !month || !day) return null;
  return {
    date: `${year}-${month}-${day}`,
    hour,
    minute,
  };
}

async function autoCloseTenantCashForDate(tenantId, dateStr) {
  const dayRange = startEndOfDayLocalSQL(dateStr);
  if (!dayRange) return;

  const branchScopeId = 0;

  const [existingRows] = await pool.query(
    `SELECT id
     FROM tenant_cash_closures
     WHERE tenant_id = :tenantId
       AND closure_date = :closureDate
       AND branch_scope_id = :branchScopeId
     LIMIT 1`,
    {
      tenantId,
      closureDate: dateStr,
      branchScopeId,
    }
  );
  if (existingRows.length) return;

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
    `,
    {
      tenantId,
      start: dayRange.start,
      end: dayRange.end,
    }
  );

  const totals = dayRows?.[0] || {};
  const doneCount = Number(totals.services_done) || 0;
  if (doneCount <= 0) return;

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
    GROUP BY a.barber_id, b.full_name
    ORDER BY revenue_ars DESC, services_done DESC, barber_name ASC
    `,
    {
      tenantId,
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
    GROUP BY a.service_id, s.name
    ORDER BY revenue_ars DESC, services_done DESC, service_name ASC
    LIMIT 20
    `,
    {
      tenantId,
      start: dayRange.start,
      end: dayRange.end,
    }
  );

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

  await pool.query(
    `INSERT IGNORE INTO tenant_cash_closures
     (tenant_id, branch_scope_id, branch_id, closure_date,
      services_done, revenue_ars, commission_ars,
      by_barber_json, by_service_json, closed_by_user_id, notes)
     VALUES
     (:tenantId, :branchScopeId, NULL, :closureDate,
      :servicesDone, :revenueArs, :commissionArs,
      :byBarberJson, :byServiceJson, NULL, :notes)`,
    {
      tenantId,
      branchScopeId,
      closureDate: dateStr,
      servicesDone: doneCount,
      revenueArs: Number(totals.revenue_ars) || 0,
      commissionArs: Number(totals.commission_ars) || 0,
      byBarberJson: JSON.stringify(byBarber),
      byServiceJson: JSON.stringify(byService),
      notes: "Cierre diario automático (23:00)",
    }
  );

  console.info("[cash-auto-close] cierre automático generado", {
    tenantId,
    date: dateStr,
    servicesDone: doneCount,
  });
}

async function tickCashAutoClose() {
  if (running) return;
  running = true;
  try {
    const [tenants] = await pool.query(
      `SELECT id, timezone
       FROM tenants`
    );

    for (const tenant of tenants) {
      const tenantId = Number(tenant.id);
      if (!tenantId) continue;

      const tz = tenant.timezone || "America/Argentina/Buenos_Aires";
      const parts = getDateTimePartsInTimezone(new Date(), tz);
      if (!parts) continue;

      // Corre una sola vez por tenant por día, cuando ya llegó a las 23:00.
      if (parts.hour < 23) continue;
      const runKey = `${tenantId}:${parts.date}`;
      if (lastRunByTenantDay.get(runKey)) continue;

      try {
        await autoCloseTenantCashForDate(tenantId, parts.date);
      } catch (e) {
        if (e?.code === "ER_NO_SUCH_TABLE") {
          console.warn(
            "[cash-auto-close] Falta tabla tenant_cash_closures. Ejecuta la migración 015."
          );
        } else {
          console.error("[cash-auto-close] error", { tenantId, date: parts.date, error: e?.message || e });
        }
      } finally {
        lastRunByTenantDay.set(runKey, true);
      }
    }
  } catch (e) {
    console.error("[cash-auto-close] tick error", e);
  } finally {
    running = false;
  }
}

function startCashAutoCloseJob() {
  if (timer) return;
  timer = setInterval(tickCashAutoClose, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  // primer chequeo al iniciar
  tickCashAutoClose().catch(() => {});
  console.info("[cash-auto-close] job iniciado (cada 60s, cierre 23:00 por tenant)");
}

module.exports = {
  startCashAutoCloseJob,
};


function parseISODateOnly(s) {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return { y, mo, d };
}

// Retorna objetos Date en UTC (solo si lo necesitás para otras cosas)
function startEndOfDayUTC(dateStr) {
  const p = parseISODateOnly(dateStr);
  if (!p) return null;

  const start = new Date(Date.UTC(p.y, p.mo - 1, p.d, 0, 0, 0));
  const end = new Date(Date.UTC(p.y, p.mo - 1, p.d + 1, 0, 0, 0));
  return { start, end };
}

// Para este proyecto tratamos los DATETIME como "hora local" (sin TZ).
// Entonces armamos el rango como strings SQL para evitar corrimientos.
function startEndOfDayLocalSQL(dateStr) {
  const p = parseISODateOnly(dateStr);
  if (!p) return null;

  const yyyy = String(p.y).padStart(4, "0");
  const mm = String(p.mo).padStart(2, "0");
  const dd = String(p.d).padStart(2, "0");

  const startDate = new Date(p.y, p.mo - 1, p.d, 0, 0, 0);
  const endDate = new Date(p.y, p.mo - 1, p.d, 0, 0, 0);
  endDate.setDate(endDate.getDate() + 1);

  const yyyy2 = endDate.getFullYear();
  const mm2 = String(endDate.getMonth() + 1).padStart(2, "0");
  const dd2 = String(endDate.getDate()).padStart(2, "0");

  return {
    start: `${yyyy}-${mm}-${dd} 00:00:00`,
    end: `${yyyy2}-${mm2}-${dd2} 00:00:00`,
  };
}

/**
 * ✅ Parse seguro de "YYYY-MM-DD HH:mm:ss" -> Date LOCAL
 * También soporta Date por si algún día mysql2 lo devuelve así.
 */
function parseMySQLDateTimeLocal(v) {
  if (!v) return new Date(NaN);

  if (v instanceof Date) return new Date(v.getTime());

  const s = String(v);
  const [datePart, timePart] = s.split(" ");
  if (datePart && timePart && /^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const [y, m, d] = datePart.split("-").map(Number);
    const [hh, mm, ss] = timePart.split(":").map((x) => Number(x || 0));
    return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0, 0);
  }

  // fallback
  return new Date(s);
}

function setTime(baseDate, hh, mm) {
  const d = new Date(baseDate);
  d.setHours(hh, mm, 0, 0);
  return d;
}

/**
 * ✅ Horarios de atención
 * - Lun(1)-Jue(4): 09:30-13:00 y 18:00-21:30
 * - Vie(5)-Sab(6): 09:30-14:00 y 16:00-22:00
 * - Dom(0): cerrado
 *
 * Devuelve ventanas como Date LOCAL para ese día.
 */
function getBusinessWindows(dateLike) {
  const day = dateLike instanceof Date ? new Date(dateLike) : new Date(dateLike);
  if (Number.isNaN(day.getTime())) return [];

  const dow = day.getDay(); // 0=Dom ... 6=Sab
  if (dow === 0) return []; // domingo cerrado

  // Lun a Jue
  if (dow >= 1 && dow <= 4) {
    return [
      { start: setTime(day, 9, 30), end: setTime(day, 13, 0) },
      { start: setTime(day, 18, 0), end: setTime(day, 21, 30) },
    ];
  }

  // Vie y Sab
  if (dow === 5 || dow === 6) {
    return [
      { start: setTime(day, 9, 30), end: setTime(day, 14, 0) },
      { start: setTime(day, 16, 0), end: setTime(day, 22, 0) },
    ];
  }

  return [];
}

/**
 * ✅ Validación fuerte:
 * - start/end deben ser válidos
 * - domingo no
 * - el turno debe entrar COMPLETO dentro de UNA sola ventana (no puede cruzar el corte)
 */
function isWithinBusinessHours(startAt, endAt) {
  const start = parseMySQLDateTimeLocal(startAt);
  const end = parseMySQLDateTimeLocal(endAt);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  if (end.getTime() <= start.getTime()) return false;

  const windows = getBusinessWindows(start);
  if (!windows.length) return false;

  return windows.some((w) => start.getTime() >= w.start.getTime() && end.getTime() <= w.end.getTime());
}

module.exports = {
  startEndOfDayUTC,
  startEndOfDayLocalSQL,
  parseMySQLDateTimeLocal,
  getBusinessWindows,
  isWithinBusinessHours,
};

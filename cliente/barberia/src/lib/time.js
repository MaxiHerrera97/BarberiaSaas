export function formatTime(d) {
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

export function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ✅ Parse robusto de DATETIME "YYYY-MM-DD HH:mm:ss" como LOCAL
export function parseMySQLDateTimeLocal(dt) {
  if (!dt) return new Date(NaN);

  if (dt instanceof Date) return new Date(dt.getTime());

  const str = String(dt);
  const parts = str.includes("T") ? str.split("T") : str.split(" ");
  const datePart = parts[0];
  const timePart = parts[1] || "00:00:00";

  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm, ss] = timePart.split(":").map((x) => Number(x || 0));

  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, ss || 0);
}

function normalizeHHMM(raw) {
  if (!raw && raw !== 0) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length < 2) return null;
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * ✅ Horarios de atención (hora local)
 * - Lun a Jue: 09:30-13:00 y 18:00-21:30
 * - Vie y Sáb: 09:30-14:00 y 16:00-22:00
 * - Dom: cerrado
 */
export function getBusinessWindows(date, businessHours = null) {
  const dow = new Date(date).getDay(); // 0 dom, 1 lun, ... 6 sáb

  if (Array.isArray(businessHours) && businessHours.length) {
    const dayRow = businessHours.find((d) => Number(d?.dayOfWeek) === dow);
    if (!dayRow || dayRow.isClosed) return [];

    const out = [];
    const open1 = normalizeHHMM(dayRow.open1);
    const close1 = normalizeHHMM(dayRow.close1);
    const open2 = normalizeHHMM(dayRow.open2);
    const close2 = normalizeHHMM(dayRow.close2);

    if (open1 && close1) out.push({ start: open1, end: close1 });
    if (open2 && close2) out.push({ start: open2, end: close2 });
    return out;
  }

  if (dow === 0) return [];

  if (dow >= 1 && dow <= 4) {
    return [
      { start: "09:30", end: "13:00" },
      { start: "18:00", end: "21:30" },
    ];
  }

  return [
    { start: "09:30", end: "14:00" },
    { start: "16:00", end: "22:00" },
  ];
}

export function setTimeFromHHMM(baseDate, hhmm) {
  const [hh, mm] = String(hhmm).split(":").map(Number);
  const d = new Date(baseDate);
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d;
}


import {
  formatTime,
  startOfDay,
  parseMySQLDateTimeLocal,
  getBusinessWindows,
  setTimeFromHHMM,
} from "../../lib/time";

export { formatTime, parseMySQLDateTimeLocal, startOfDay, getBusinessWindows };

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function diffMs(a, b) {
  return a.getTime() - b.getTime();
}

export function msToMMSS(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// ✅ genera slots de agenda cada 30 min SOLO dentro de las ventanas reales del día
export function buildDaySlots(date = new Date(), stepMin = 30, dayWindows = null) {
  const base = startOfDay(date);
  const windows =
    Array.isArray(dayWindows) && dayWindows.length ? dayWindows : getBusinessWindows(base);
  if (!windows.length) return [];
  if (!stepMin || stepMin <= 0) return [];

  const slots = [];

  for (const w of windows) {
    const start = setTimeFromHHMM(base, w.start);
    const end = setTimeFromHHMM(base, w.end);

    let cur = new Date(start);
    while (cur < end) {
      const nxt = new Date(cur);
      nxt.setMinutes(cur.getMinutes() + stepMin);

      if (nxt > end) break;

      slots.push({ start: new Date(cur), end: nxt });
      cur = nxt;
    }
  }

  return slots;
}

import {
  formatTime,
  startOfDay,
  setTimeFromHHMM,
} from "../../lib/time";

export { formatTime, startOfDay };

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function formatDate(d) {
  return d.toLocaleDateString("es-AR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  const a0 = aStart.getTime();
  const a1 = aEnd.getTime();
  const b0 = bStart.getTime();
  const b1 = bEnd.getTime();
  return a0 < b1 && a1 > b0;
}

/**
 * ✅ Genera slots cada duración del servicio dentro de las ventanas reales del día
 * y marca busy si se solapa con busyRanges (appointments + holds)
 */
export function buildSlots(
  date,
  durationMin,
  busyRanges = [],
  dayWindows = null,
  slotStepMin = durationMin,
  minAdvanceMs = 0
) {
  const base = startOfDay(date);
  const windows = Array.isArray(dayWindows) ? dayWindows : [];

  if (!durationMin || durationMin <= 0) return [];
  if (!windows.length) return []; // domingo cerrado
  if (!slotStepMin || slotStepMin <= 0) return [];

  const cutoffMs = minAdvanceMs > 0 ? Date.now() + minAdvanceMs : 0;
  const slots = [];

  for (const w of windows) {
    const start = setTimeFromHHMM(base, w.start);
    const end = setTimeFromHHMM(base, w.end);

    let cur = new Date(start);

    while (cur < end) {
      const nxt = new Date(cur);
      nxt.setMinutes(cur.getMinutes() + durationMin);

      // si el slot se pasa del horario de cierre, no lo agregamos
      if (nxt > end) break;

      const tooSoon = cutoffMs > 0 && cur.getTime() < cutoffMs;
      const busy = tooSoon || busyRanges.some((r) => overlaps(cur, nxt, r.start, r.end));

      slots.push({
        start: new Date(cur),
        end: new Date(nxt),
        status: busy ? "busy" : "free",
      });

      const step = new Date(cur);
      step.setMinutes(step.getMinutes() + slotStepMin);
      cur = step;
    }
  }

  return slots;
}

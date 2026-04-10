// Turnos mock: todos en bloques de 30 min (o 60 si quisieras)
// status: pending | in_progress | done | no_show | cancelled

export function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function makeTime(date, hh, mm) {
  const d = new Date(date);
  d.setHours(hh, mm, 0, 0);
  return d;
}

export function buildMockAppointments({ barbers, services }) {
  const base = new Date();
  base.setHours(0, 0, 0, 0);

  const s30 = services.find((s) => s.durationMin === 30) ?? services[0];
  const s60 = services.find((s) => s.durationMin === 60) ?? services[0];

  return [
    {
      id: "a1",
      barberId: barbers[0]?.id,
      serviceId: s30?.id,
      customerName: "Juan Pérez",
      customerPhone: "381 555-111",
      startAt: makeTime(base, 10, 0).toISOString(),
      endAt: makeTime(base, 10, 30).toISOString(),
      status: "pending",
    },
    {
      id: "a2",
      barberId: barbers[0]?.id,
      serviceId: s60?.id,
      customerName: "María Gómez",
      customerPhone: "",
      startAt: makeTime(base, 11, 0).toISOString(),
      endAt: makeTime(base, 12, 0).toISOString(),
      status: "pending",
    },
    {
      id: "a3",
      barberId: barbers[1]?.id,
      serviceId: s30?.id,
      customerName: "Leo Sánchez",
      customerPhone: "381 555-222",
      startAt: makeTime(base, 10, 30).toISOString(),
      endAt: makeTime(base, 11, 0).toISOString(),
      status: "pending",
    },
    {
      id: "a4",
      barberId: barbers[2]?.id,
      serviceId: s30?.id,
      customerName: "Ana Ruiz",
      customerPhone: "381 555-333",
      startAt: makeTime(base, 12, 30).toISOString(),
      endAt: makeTime(base, 13, 0).toISOString(),
      status: "pending",
    },
  ];
}
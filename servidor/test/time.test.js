const test = require("node:test");
const assert = require("node:assert/strict");

const {
  startEndOfDayLocalSQL,
  parseMySQLDateTimeLocal,
  getBusinessWindows,
  isWithinBusinessHours,
} = require("../src/utils/time");

test("startEndOfDayLocalSQL builds inclusive-exclusive SQL range", () => {
  assert.deepEqual(startEndOfDayLocalSQL("2026-03-17"), {
    start: "2026-03-17 00:00:00",
    end: "2026-03-18 00:00:00",
  });
});

test("parseMySQLDateTimeLocal parses DATETIME as local date", () => {
  const parsed = parseMySQLDateTimeLocal("2026-03-17 09:30:00");
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 2);
  assert.equal(parsed.getDate(), 17);
  assert.equal(parsed.getHours(), 9);
  assert.equal(parsed.getMinutes(), 30);
});

test("getBusinessWindows closes on sunday", () => {
  const windows = getBusinessWindows(new Date(2026, 2, 15, 10, 0, 0));
  assert.equal(windows.length, 0);
});

test("isWithinBusinessHours accepts valid weekday slot", () => {
  assert.equal(
    isWithinBusinessHours("2026-03-17 09:30:00", "2026-03-17 10:00:00"),
    true
  );
});

test("isWithinBusinessHours rejects slots crossing midday break", () => {
  assert.equal(
    isWithinBusinessHours("2026-03-17 12:45:00", "2026-03-17 13:15:00"),
    false
  );
});

test("isWithinBusinessHours rejects sunday appointments", () => {
  assert.equal(
    isWithinBusinessHours("2026-03-15 10:00:00", "2026-03-15 10:30:00"),
    false
  );
});

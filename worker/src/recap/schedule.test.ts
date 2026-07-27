import { describe, expect, it } from "vitest";
import { RECAP_TIME_ZONE, hourInTimeZone, isRecapHour } from "./schedule";

const at = (iso: string) => new Date(iso).getTime();

describe("isRecapHour", () => {
  // Daylight saving (EDT, UTC-4): early season through early November.
  it("runs the 12:00 UTC slot during daylight saving", () => {
    expect(isRecapHour(at("2026-09-15T12:00:00Z"))).toBe(true);
  });

  it("ignores the 13:00 UTC slot during daylight saving", () => {
    expect(isRecapHour(at("2026-09-15T13:00:00Z"))).toBe(false);
  });

  // Standard time (EST, UTC-5): the rest of the season, including playoffs.
  it("runs the 13:00 UTC slot outside daylight saving", () => {
    expect(isRecapHour(at("2026-12-15T13:00:00Z"))).toBe(true);
  });

  it("ignores the 12:00 UTC slot outside daylight saving", () => {
    // This is the bug the second slot exists to fix: on its own, 12:00 UTC
    // delivers the recap an hour early for half the season.
    expect(isRecapHour(at("2026-12-15T12:00:00Z"))).toBe(false);
  });

  it("fires exactly once on every Tuesday of a season", () => {
    // Sept 2026 through Jan 2027 spans the November changeover.
    const tuesdays: string[] = [];
    const cursor = new Date("2026-09-01T00:00:00Z");
    while (cursor < new Date("2027-01-31T00:00:00Z")) {
      if (cursor.getUTCDay() === 2) {
        tuesdays.push(cursor.toISOString().slice(0, 10));
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    expect(tuesdays.length).toBeGreaterThan(20);

    for (const day of tuesdays) {
      const fired = [`${day}T12:00:00Z`, `${day}T13:00:00Z`].filter((t) =>
        isRecapHour(at(t)),
      );
      expect(fired, `expected exactly one 8am ET run on ${day}`).toHaveLength(1);
      expect(hourInTimeZone(new Date(fired[0]!), RECAP_TIME_ZONE)).toBe(8);
    }
  });
});

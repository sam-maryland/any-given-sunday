import { describe, expect, it } from "vitest";
import {
  RECAP_TIME_ZONE,
  hourInTimeZone,
  localHourToInstant,
  recapEmailTime,
} from "./schedule";

const at = (iso: string) => new Date(iso).getTime();

describe("localHourToInstant", () => {
  it("resolves 8am Eastern during daylight saving", () => {
    const target = localHourToInstant(new Date("2026-09-15T11:00:00Z"), 8, RECAP_TIME_ZONE);
    expect(target.toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  it("resolves 8am Eastern outside daylight saving", () => {
    // The hour that shifts mid-season: the same wall-clock time is an hour
    // later in UTC once Eastern falls back.
    const target = localHourToInstant(new Date("2026-12-15T11:00:00Z"), 8, RECAP_TIME_ZONE);
    expect(target.toISOString()).toBe("2026-12-15T13:00:00.000Z");
  });

  it("lands on 8am local on every Tuesday of a season", () => {
    const cursor = new Date("2026-09-01T11:00:00Z");
    let checked = 0;

    while (cursor < new Date("2027-01-31T00:00:00Z")) {
      if (cursor.getUTCDay() === 2) {
        const target = localHourToInstant(cursor, 8, RECAP_TIME_ZONE);
        expect(
          hourInTimeZone(target, RECAP_TIME_ZONE),
          `expected 8am Eastern for ${cursor.toISOString()}`,
        ).toBe(8);
        // Always later the same morning than an 11:00 UTC run.
        expect(target.getTime()).toBeGreaterThan(cursor.getTime());
        checked++;
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    expect(checked).toBeGreaterThan(20);
  });
});

describe("recapEmailTime", () => {
  it("schedules ahead when the job runs before 8am Eastern", () => {
    // 11:00 UTC is 7am Eastern in September.
    const target = recapEmailTime(at("2026-09-15T11:00:00Z"));
    expect(target?.toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  it("schedules ahead outside daylight saving too", () => {
    // 11:00 UTC is 6am Eastern in December, so there is two hours to wait.
    const target = recapEmailTime(at("2026-12-15T11:00:00Z"));
    expect(target?.toISOString()).toBe("2026-12-15T13:00:00.000Z");
  });

  it("sends immediately rather than scheduling into the past", () => {
    // A manual or delayed run after 8am Eastern must not ask Resend for a
    // delivery time that has already gone.
    expect(recapEmailTime(at("2026-09-15T18:00:00Z"))).toBeNull();
  });

  it("sends immediately when the job runs exactly at 8am Eastern", () => {
    expect(recapEmailTime(at("2026-09-15T12:00:00Z"))).toBeNull();
  });
});

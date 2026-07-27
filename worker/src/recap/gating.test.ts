import { describe, expect, it } from "vitest";
import { notificationsHeldReason } from "./index";

// The recap runs every week year-round so the database is touched often
// enough that a free Supabase project never pauses. These rules decide when
// that run should actually tell anyone about it.
describe("notificationsHeldReason", () => {
  it("sends during the regular season when new matchups were recorded", () => {
    expect(notificationsHeldReason("regular", 6)).toBeNull();
  });

  it("sends during the postseason when new matchups were recorded", () => {
    expect(notificationsHeldReason("post", 2)).toBeNull();
  });

  it("stays quiet in the offseason", () => {
    // Sleeper reports season_type "off" between seasons. Without this the
    // recap would re-send the final week's summary every Tuesday all winter.
    expect(notificationsHeldReason("off", 0)).toBe('NFL season_type is "off"');
  });

  it("stays quiet in the preseason", () => {
    expect(notificationsHeldReason("pre", 0)).toBe('NFL season_type is "pre"');
  });

  it("stays quiet in the offseason even if matchups were somehow recorded", () => {
    expect(notificationsHeldReason("off", 6)).toBe('NFL season_type is "off"');
  });

  it("stays quiet in season when nothing new was recorded", () => {
    // Covers a second run in the same week: the first run already stored the
    // week's games, so re-running must not send the recap again.
    expect(notificationsHeldReason("regular", 0)).toBe(
      "no new matchups were recorded this run",
    );
  });

  it("treats an unrecognised season_type as inactive", () => {
    expect(notificationsHeldReason("something-new", 6)).toContain("season_type");
  });
});

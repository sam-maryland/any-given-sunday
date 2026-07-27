// League members expect the recap email at 8am Eastern on Tuesday. Cron
// triggers are UTC-only and Eastern shifts by an hour in early November —
// mid-season — so the cron alone cannot hold a fixed local time. Instead the
// cron runs comfortably before 8am Eastern, and the email is handed to Resend
// with a scheduled_at of exactly 8am Eastern. The Discord post goes out when
// the job runs, which is earlier.

export const RECAP_TIME_ZONE = "America/New_York";
export const RECAP_LOCAL_HOUR = 8;

/** The hour (0-23) that `date` falls on in the given IANA time zone. */
export function hourInTimeZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);

  const hour = parts.find((p) => p.type === "hour")?.value;
  // hourCycle h23 reports midnight as "24" in some implementations.
  return Number(hour) % 24;
}

/** How far the given zone is ahead of UTC, in milliseconds, at `date`. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const field = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour") % 24,
    field("minute"),
    field("second"),
  );
  return asIfUtc - date.getTime();
}

/**
 * The instant at which it is `hour` o'clock, on the same local calendar day
 * that `reference` falls on, in `timeZone`.
 *
 * Resolves the zone offset at the target rather than at the reference, so it
 * stays correct across a daylight saving change. Only meaningful for hours
 * away from the 2am transition itself, which 8am is.
 */
export function localHourToInstant(
  reference: Date,
  hour: number,
  timeZone: string,
): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);
  const field = (type: string) => Number(parts.find((p) => p.type === type)?.value);

  // Treat the wall-clock target as if it were UTC, then subtract the zone's
  // offset at approximately that instant to get the real one.
  const naive = Date.UTC(field("year"), field("month") - 1, field("day"), hour);
  return new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
}

/**
 * When the recap email should land: 8am Eastern on the day the job runs.
 *
 * @param scheduledTime the cron's intended time (controller.scheduledTime)
 * @returns the delivery instant, or null if 8am Eastern has already passed —
 *   in which case the email should just go out immediately rather than being
 *   scheduled into the past
 */
export function recapEmailTime(scheduledTime: number): Date | null {
  const target = localHourToInstant(
    new Date(scheduledTime),
    RECAP_LOCAL_HOUR,
    RECAP_TIME_ZONE,
  );
  return target.getTime() > scheduledTime ? target : null;
}

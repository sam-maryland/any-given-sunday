// League members expect the recap at 8am Eastern on Tuesday. Cron triggers
// are UTC-only, so 8am Eastern is 12:00 UTC during daylight saving and 13:00
// UTC outside it — and the NFL season spans that changeover in early
// November. Both slots are registered in wrangler.jsonc and this decides
// which one is actually 8am today, so exactly one run happens per Tuesday.

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

/**
 * Whether this scheduled invocation is the one that lands on 8am Eastern.
 *
 * @param scheduledTime the cron's intended time (controller.scheduledTime),
 *   not the current clock, so a delayed invocation still evaluates the slot
 *   it was scheduled for
 */
export function isRecapHour(scheduledTime: number): boolean {
  return hourInTimeZone(new Date(scheduledTime), RECAP_TIME_ZONE) === RECAP_LOCAL_HOUR;
}

import { SupabaseClient } from "./data/supabase";

/**
 * The daily keepalive's cron expression. It must match the entry in
 * wrangler.jsonc, since the scheduled handler tells the two crons apart by
 * this string.
 */
export const KEEPALIVE_CRON = "0 6 * * *";

/**
 * Reads one row so the Supabase project sees API traffic every day.
 *
 * A free project pauses after about a week without activity. The weekly recap
 * alone sits right on that line: the recap of Oct 27 2026 was the project's
 * last request, Supabase paused it early on Nov 3 before the next recap ran,
 * and weeks 8 and 9 never synced. Since the dashboard reads from Sleeper
 * rather than the database, nothing else touches it between recaps.
 */
export async function runKeepalive(db: SupabaseClient): Promise<{ league: number | null }> {
  const league = await db.getLatestLeague();
  return { league: league?.year ?? null };
}

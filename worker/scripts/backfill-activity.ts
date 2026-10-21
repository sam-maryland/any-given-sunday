// Stores every season's rosters, transactions and draft. The weekly recap
// keeps the current season up to date; this fills in the seasons before it,
// which the recap never revisits. Safe to re-run: every write is an upsert.
//   npm run backfill-activity
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .dev.vars.example).

import { getLeague, getNFLState } from "../src/data/sleeper";
import { SupabaseClient } from "../src/data/supabase";
import { LeagueStatus } from "../src/domain/types";
import { LAST_TRANSACTION_WEEK, syncLeagueActivity } from "../src/recap/activity";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

const db = new SupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const nflState = await getNFLState();

for (const league of await db.getStartedLeagues()) {
  const sleeperLeague = await getLeague(league.id);
  const throughWeek =
    league.status === LeagueStatus.InProgress ? Math.max(nflState.week, 1) : LAST_TRANSACTION_WEEK;
  const result = await syncLeagueActivity(db, league.id, league.year, sleeperLeague.draft_id, throughWeek);
  console.log(JSON.stringify({ year: league.year, ...result }));
}

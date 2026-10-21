// Names every player who has been through the league, from Sleeper's full
// player list. The Worker cannot do this on the free plan (the list is too
// big to parse in 10 ms of CPU), so a weekly GitHub Action runs it after the
// Tuesday recap has stored the week's transactions. Safe to re-run: every
// write is an upsert, which also picks up team and position changes.
//   npm run sync-players
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .dev.vars.example).

import { getAllPlayers } from "../src/data/sleeper";
import { SupabaseClient } from "../src/data/supabase";
import { playerIdsInLeague, playerRows } from "../src/domain/players";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

const db = new SupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const [transactions, draftPicks, sleeper] = await Promise.all([
  db.getAllTransactions(),
  db.getAllDraftPicks(),
  getAllPlayers(),
]);

const { rows, missing } = playerRows(playerIdsInLeague(transactions, draftPicks), sleeper);
await db.upsertPlayers(rows);
console.log(JSON.stringify({ players: rows.length, missing }));

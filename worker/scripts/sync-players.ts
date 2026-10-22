// Names every player who has been through the league, from Sleeper's full
// player list. The Worker cannot do this on the free plan (the list is too
// big to parse in 10 ms of CPU), so a weekly GitHub Action runs it after the
// Tuesday recap has stored the week's transactions. Safe to re-run: every
// write is an upsert, which also picks up team and position changes.
//
// It also writes a trimmed copy of the whole list, every NFL player as
// { [id]: [name, position, team] }, to the Worker's PLAYERS KV namespace,
// which /api/nfl-players serves as is so a browser can name the players of
// any league. That step is skipped when its Cloudflare settings are unset.
//   npm run sync-players
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .dev.vars.example);
// the KV write also needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and
// PLAYERS_KV_NAMESPACE_ID.

import { getAllPlayers } from "../src/data/sleeper";
import { SupabaseClient } from "../src/data/supabase";
import { playerIdsInLeague, playerRows } from "../src/domain/players";

const NFL_PLAYERS_KEY = "nfl-players";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PLAYERS_KV_NAMESPACE_ID } =
  process.env;
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

// Named the same way as the table above; Sleeper entries with no name at all
// (a handful of placeholders) are left out rather than sent nameless.
const all = playerRows(Object.keys(sleeper), sleeper);
const compact = JSON.stringify(Object.fromEntries(all.rows.map((p) => [p.id, [p.name, p.position, p.team]])));
const bytes = new TextEncoder().encode(compact).byteLength;

if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !PLAYERS_KV_NAMESPACE_ID) {
  console.log(
    JSON.stringify({
      nflPlayers: "skipped: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and PLAYERS_KV_NAMESPACE_ID are not all set",
      players: all.rows.length,
      bytes,
    }),
  );
} else {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${PLAYERS_KV_NAMESPACE_ID}/values/${NFL_PLAYERS_KEY}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
      body: compact,
    },
  );
  if (!res.ok) {
    throw new Error(`KV write of ${NFL_PLAYERS_KEY} failed: ${res.status} ${await res.text()}`);
  }
  console.log(JSON.stringify({ nflPlayers: "written", players: all.rows.length, missing: all.missing.length, bytes }));
}

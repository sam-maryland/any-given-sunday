import { SleeperPlayer } from "../data/sleeper";
import { DraftPick, Player, Transaction } from "./types";

/** Every player the league has drafted, traded, claimed or dropped. */
export function playerIdsInLeague(transactions: Transaction[], draftPicks: DraftPick[]): Set<string> {
  const ids = new Set<string>();
  for (const t of transactions) {
    for (const id of Object.keys(t.adds ?? {})) ids.add(id);
    for (const id of Object.keys(t.drops ?? {})) ids.add(id);
  }
  for (const p of draftPicks) ids.add(p.player_id);
  return ids;
}

export interface PlayerRows {
  rows: Player[];
  /** Ids Sleeper's list does not have: worth a look, never seen so far. */
  missing: string[];
}

/** The given players as rows, named as Sleeper names them today. */
export function playerRows(ids: Iterable<string>, sleeper: Record<string, SleeperPlayer>): PlayerRows {
  const rows: Player[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const p = sleeper[id];
    const name = p && (p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" "));
    if (!p || !name) {
      missing.push(id);
      continue;
    }
    rows.push({ id, name, position: p.position || null, team: p.team || null });
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return { rows, missing: missing.sort() };
}

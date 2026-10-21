import { Roster, Transaction } from "./types";

/**
 * Each owner's dealings on the transaction wire: trades with who and for
 * what, and pickups off waivers and free agency.
 *
 * Sleeper names rosters, not users, and a roster id is only meaningful in
 * its own league, so every roster is resolved through that league's rosters.
 * A roster with no owner on record is skipped rather than guessed at. Pure
 * and I/O-free; the API handler does the loading.
 */

export interface TradePartner {
  userId: string;
  trades: number;
}

export interface TradeStats {
  /** Completed trades only; a vetoed or expired one never happened. */
  trades: number;
  picksSent: number;
  picksReceived: number;
  playersSent: number;
  playersReceived: number;
  /** Most trades first; ties by user id, so the order is stable. */
  partners: TradePartner[];
  /** Successful waiver claims. */
  waiverAdds: number;
  freeAgentAdds: number;
  /** Waiver claims that lost out to a higher bid or priority. */
  failedClaims: number;
}

export const emptyTradeStats = (): TradeStats => ({
  trades: 0,
  picksSent: 0,
  picksReceived: 0,
  playersSent: 0,
  playersReceived: 0,
  partners: [],
  waiverAdds: 0,
  freeAgentAdds: 0,
  failedClaims: 0,
});

/** user id → stats, for every owner with at least one resolvable transaction. */
export function buildTradeStats(transactions: Transaction[], rosters: Roster[]): Map<string, TradeStats> {
  const owners = new Map<string, string>();
  for (const r of rosters) owners.set(`${r.league_id}:${r.roster_id}`, r.user_id);
  const ownerOf = (t: Transaction, rosterId: number) => owners.get(`${t.league_id}:${rosterId}`);

  const stats = new Map<string, TradeStats>();
  const partners = new Map<string, Map<string, number>>();
  const statsFor = (userId: string) => {
    let s = stats.get(userId);
    if (!s) stats.set(userId, (s = emptyTradeStats()));
    return s;
  };

  for (const t of transactions) {
    if (t.type === "trade") {
      if (t.status !== "complete") continue;
      const sides = [...new Set(t.roster_ids.map((id) => ownerOf(t, id)).filter((u): u is string => !!u))];
      for (const userId of sides) {
        statsFor(userId).trades++;
        const mine = partners.get(userId) ?? new Map<string, number>();
        for (const other of sides) if (other !== userId) mine.set(other, (mine.get(other) ?? 0) + 1);
        partners.set(userId, mine);
      }
      for (const p of t.draft_picks ?? []) {
        const from = ownerOf(t, p.previous_owner_id);
        const to = ownerOf(t, p.owner_id);
        if (from) statsFor(from).picksSent++;
        if (to) statsFor(to).picksReceived++;
      }
      for (const rosterId of Object.values(t.adds ?? {})) {
        const to = ownerOf(t, rosterId);
        if (to) statsFor(to).playersReceived++;
      }
      for (const rosterId of Object.values(t.drops ?? {})) {
        const from = ownerOf(t, rosterId);
        if (from) statsFor(from).playersSent++;
      }
      continue;
    }

    if (t.type !== "waiver" && t.type !== "free_agent") continue;
    // A claim names one roster; a pure drop has no adds and is not a pickup.
    const rosterId = t.roster_ids[0];
    const userId = rosterId === undefined ? undefined : ownerOf(t, rosterId);
    if (!userId) continue;
    if (t.type === "waiver" && t.status === "failed") statsFor(userId).failedClaims++;
    else if (t.status === "complete" && Object.keys(t.adds ?? {}).length > 0) {
      if (t.type === "waiver") statsFor(userId).waiverAdds++;
      else statsFor(userId).freeAgentAdds++;
    }
  }

  for (const [userId, counts] of partners) {
    statsFor(userId).partners = [...counts]
      .map(([other, trades]) => ({ userId: other, trades }))
      .sort((a, b) => b.trades - a.trades || a.userId.localeCompare(b.userId));
  }
  return stats;
}

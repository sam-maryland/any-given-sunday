import {
  SleeperDraft,
  SleeperDraftPick,
  SleeperRoster,
  SleeperTransaction,
  getDraft,
  getDraftPicks,
  getRostersInLeague,
  getTransactionsForWeek,
} from "../data/sleeper";
import { SupabaseClient } from "../data/supabase";
import { DraftPick, Roster, Transaction } from "../domain/types";

// Sleeper files nothing past the last week of the NFL regular season.
export const LAST_TRANSACTION_WEEK = 18;

export interface ActivitySyncResult {
  weeksFetched: number[];
  transactions: number;
  trades: number;
  draftPicks: number;
}

/**
 * Syncs a league's rosters, transactions and draft into the database.
 *
 * Transactions are fetched from the latest week already stored through
 * `throughWeek`. The latest stored week is fetched again because it may have
 * gained transactions since it was last read; earlier weeks are settled. Rows
 * are upserted by Sleeper's ids, so re-reading a week rewrites it rather than
 * duplicating it.
 *
 * The draft is stored once, after Sleeper marks it complete.
 */
export async function syncLeagueActivity(
  db: SupabaseClient,
  leagueId: string,
  year: number,
  draftId: string | null | undefined,
  throughWeek: number,
): Promise<ActivitySyncResult> {
  await db.upsertRosters(rosterRows(await getRostersInLeague(leagueId), leagueId));

  const fromWeek = (await db.getLatestTransactionWeek(leagueId)) ?? 1;
  const weeksFetched: number[] = [];
  const transactions: Transaction[] = [];
  for (let week = fromWeek; week <= Math.min(throughWeek, LAST_TRANSACTION_WEEK); week++) {
    weeksFetched.push(week);
    for (const tx of await getTransactionsForWeek(leagueId, week)) {
      transactions.push(transactionRow(tx, leagueId, year));
    }
  }
  await db.upsertTransactions(transactions);

  let draftPicks = 0;
  if (draftId && !(await db.hasDraftPicks(draftId))) {
    const draft = await getDraft(draftId);
    if (draft.status === "complete") {
      const rows = draftPickRows(draft, await getDraftPicks(draftId), leagueId, year);
      await db.upsertDraftPicks(rows);
      draftPicks = rows.length;
    }
  }

  return {
    weeksFetched,
    transactions: transactions.length,
    trades: transactions.filter((t) => t.type === "trade" && t.status === "complete").length,
    draftPicks,
  };
}

// A roster nobody owns has no owner to record.
export function rosterRows(rosters: SleeperRoster[], leagueId: string): Roster[] {
  return rosters
    .filter((r) => !!r.owner_id)
    .map((r) => ({ league_id: leagueId, roster_id: r.roster_id, user_id: r.owner_id }));
}

export function transactionRow(tx: SleeperTransaction, leagueId: string, year: number): Transaction {
  return {
    id: tx.transaction_id,
    league_id: leagueId,
    year,
    week: tx.leg,
    type: tx.type,
    status: tx.status,
    roster_ids: tx.roster_ids ?? [],
    adds: tx.adds,
    drops: tx.drops,
    // Sleeper also sends a league_id on each pick, always null in this
    // league; only the fields that identify and move the pick are kept.
    draft_picks: (tx.draft_picks ?? []).map((p) => ({
      season: p.season,
      round: p.round,
      roster_id: p.roster_id,
      previous_owner_id: p.previous_owner_id,
      owner_id: p.owner_id,
    })),
    waiver_budget: tx.waiver_budget ?? [],
    created_at: new Date(tx.created).toISOString(),
    completed_at: tx.status_updated ? new Date(tx.status_updated).toISOString() : null,
  };
}

/**
 * A pick's original roster comes from the board column it sits in, not from
 * who made it: a traded pick is still named after the roster it was issued
 * to, and that is how it is matched to the trades that moved it. Checked
 * against Sleeper's traded_picks for the 2024 through 2026 rookie drafts.
 */
export function draftPickRows(
  draft: SleeperDraft,
  picks: SleeperDraftPick[],
  leagueId: string,
  year: number,
): DraftPick[] {
  return picks.map((p) => ({
    draft_id: draft.draft_id,
    league_id: leagueId,
    year,
    pick_no: p.pick_no,
    round: p.round,
    draft_slot: p.draft_slot,
    original_roster_id: draft.slot_to_roster_id?.[String(p.draft_slot)] ?? p.roster_id,
    roster_id: p.roster_id,
    player_id: p.player_id,
    player_name: [p.metadata?.first_name, p.metadata?.last_name].filter(Boolean).join(" "),
    position: p.metadata?.position ?? "",
  }));
}

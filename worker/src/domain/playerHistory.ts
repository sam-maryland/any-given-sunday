import { DraftPick, Player, Roster, TradedPick, Transaction } from "./types";

/**
 * One player's path through the league: the pick he was drafted with and
 * every owner that pick passed through, then each trade, pickup and drop.
 *
 * Sleeper names rosters, not users, and picks by the roster they were issued
 * to, so every roster here is resolved through the rosters of the league the
 * move was made in. Pure and I/O-free; the API handler does the loading.
 */

export type Asset =
  | { kind: "player"; id: string; name: string; position: string | null }
  | {
      kind: "pick";
      season: string;
      round: number;
      /** Who the pick was issued to, so two owners' 2nds can be told apart. */
      originalOwnerId: string | null;
      /** The player taken with it, once the draft has happened. */
      became: { id: string; name: string } | null;
    };

/** One step of a trade, seen from the asset being followed. */
export interface TradeLeg {
  at: string;
  year: number;
  fromId: string | null;
  toId: string | null;
  /** Everything else that went the same way. */
  sentWith: Asset[];
  /** What the sending owner got back. */
  receivedFor: Asset[];
}

export type PlayerEvent =
  | {
      kind: "drafted";
      year: number;
      startup: boolean;
      /** Kept from last season rather than drafted, in a keeper league. */
      keeper: boolean;
      round: number;
      /** Pick within the round: the 4 of 1.04. */
      pickInRound: number;
      pickNo: number;
      byId: string | null;
      originalOwnerId: string | null;
      /** The trades that brought the pick to the drafting owner, oldest first. */
      pickTrades: TradeLeg[];
    }
  | ({ kind: "traded" } & TradeLeg)
  | {
      kind: "added";
      at: string;
      year: number;
      via: "waiver" | "free_agent" | "commissioner";
      byId: string | null;
      /** Players let go in the same move to make room. */
      alongside: Asset[];
    }
  | {
      kind: "dropped";
      at: string;
      year: number;
      via: "waiver" | "free_agent" | "commissioner";
      byId: string | null;
      /** Players picked up in the same move: who he was dropped for. */
      alongside: Asset[];
    };

export interface PlayerHistory {
  /** Oldest first; a draft, when there was one, always leads. */
  events: PlayerEvent[];
  /** The owner holding him as of the last sync; null when he is a free agent. */
  currentOwnerId: string | null;
  /** Every owner the events mention, for the caller to name. */
  ownerIds: string[];
}

export interface PlayerHistoryInput {
  playerId: string;
  /** This player's draft pick, if he was drafted. */
  draftPicks: DraftPick[];
  /** Every transaction moving him or the pick he was drafted with. */
  transactions: Transaction[];
  rosters: Roster[];
  /** The startup draft's season: every later draft is a rookie draft. */
  startupYear: number | null;
  /** Names for the players these transactions mention. */
  players: Map<string, Player>;
  /** Picks these transactions moved that have since been made. */
  pickResults: DraftPick[];
}

/** A pick slot, as a traded pick names it and a made pick can be found by. */
export interface PickSlot {
  year: number;
  round: number;
  originalRosterId: number;
}

/** What the handler must look up before building: names and pick results. */
export function lookupsFor(transactions: Transaction[]): { playerIds: string[]; pickSlots: PickSlot[] } {
  const playerIds = new Set<string>();
  const slots = new Map<string, PickSlot>();
  for (const t of transactions) {
    for (const id of Object.keys(t.adds ?? {})) playerIds.add(id);
    for (const id of Object.keys(t.drops ?? {})) playerIds.add(id);
    for (const p of t.draft_picks ?? []) {
      const slot = { year: Number(p.season), round: p.round, originalRosterId: p.roster_id };
      slots.set(slotKey(slot), slot);
    }
  }
  return { playerIds: [...playerIds].sort(), pickSlots: [...slots.values()] };
}

const slotKey = (s: PickSlot) => `${s.year}:${s.round}:${s.originalRosterId}`;
const at = (t: Transaction) => t.completed_at ?? t.created_at;

export function buildPlayerHistory(input: PlayerHistoryInput): PlayerHistory {
  const { playerId } = input;
  const owners = new Map<string, string>();
  const teams = new Map<string, number>();
  for (const r of input.rosters) {
    owners.set(`${r.league_id}:${r.roster_id}`, r.user_id);
    teams.set(r.league_id, (teams.get(r.league_id) ?? 0) + 1);
  }
  const ownerIn = (leagueId: string, rosterId: number | undefined) =>
    rosterId === undefined ? null : (owners.get(`${leagueId}:${rosterId}`) ?? null);

  const made = new Map<string, DraftPick>();
  for (const p of input.pickResults) made.set(slotKey({ year: p.year, round: p.round, originalRosterId: p.original_roster_id }), p);

  const playerAsset = (id: string): Asset => {
    const p = input.players.get(id);
    return { kind: "player", id, name: p?.name ?? `Player ${id}`, position: p?.position ?? null };
  };
  const pickAsset = (t: Transaction, p: TradedPick): Asset => {
    const result = made.get(slotKey({ year: Number(p.season), round: p.round, originalRosterId: p.roster_id }));
    return {
      kind: "pick",
      season: p.season,
      round: p.round,
      originalOwnerId: ownerIn(t.league_id, p.roster_id),
      became: result ? { id: result.player_id, name: input.players.get(result.player_id)?.name ?? result.player_name } : null,
    };
  };

  /** Every asset a trade moved, with the rosters it went between. */
  const moves = (t: Transaction) => [
    ...Object.entries(t.adds ?? {}).map(([id, to]) => ({ key: `player:${id}`, from: t.drops?.[id], to, asset: () => playerAsset(id) })),
    ...(t.draft_picks ?? []).map((p) => ({
      key: `pick:${p.season}:${p.round}:${p.roster_id}`,
      from: p.previous_owner_id as number | undefined,
      to: p.owner_id,
      asset: () => pickAsset(t, p),
    })),
  ];

  /** A trade seen from one asset that went from one roster to another. */
  const leg = (t: Transaction, subjectKey: string): TradeLeg | null => {
    const all = moves(t);
    const subject = all.find((m) => m.key === subjectKey);
    if (!subject || subject.from === undefined) return null;
    return {
      at: at(t),
      year: t.year,
      fromId: ownerIn(t.league_id, subject.from),
      toId: ownerIn(t.league_id, subject.to),
      sentWith: all.filter((m) => m !== subject && m.from === subject.from && m.to === subject.to).map((m) => m.asset()),
      receivedFor: all.filter((m) => m.to === subject.from && m.from !== subject.from).map((m) => m.asset()),
    };
  };

  const complete = input.transactions
    .filter((t) => t.status === "complete")
    .sort((a, b) => at(a).localeCompare(at(b)) || a.id.localeCompare(b.id));

  const events: PlayerEvent[] = [];
  for (const pick of input.draftPicks) {
    const slot = `pick:${pick.year}:${pick.round}:${pick.original_roster_id}`;
    const pickTrades = complete
      .filter((t) => t.type === "trade")
      .map((t) => leg(t, slot))
      .filter((l): l is TradeLeg => l !== null);
    const size = teams.get(pick.league_id) ?? 0;
    events.push({
      kind: "drafted",
      year: pick.year,
      startup: pick.year === input.startupYear,
      keeper: pick.is_keeper === true,
      round: pick.round,
      pickInRound: size ? ((pick.pick_no - 1) % size) + 1 : pick.draft_slot,
      pickNo: pick.pick_no,
      byId: ownerIn(pick.league_id, pick.roster_id),
      originalOwnerId: ownerIn(pick.league_id, pick.original_roster_id),
      pickTrades,
    });
  }

  for (const t of complete) {
    const addedTo = t.adds?.[playerId];
    const droppedBy = t.drops?.[playerId];
    if (addedTo === undefined && droppedBy === undefined) continue; // a pick trade, told above
    if (t.type === "trade") {
      const l = leg(t, `player:${playerId}`);
      if (l) events.push({ kind: "traded", ...l });
      continue;
    }
    const via = t.type === "waiver" || t.type === "free_agent" ? t.type : "commissioner";
    const others = (side: Record<string, number> | null, rosterId: number) =>
      Object.entries(side ?? {})
        .filter(([id, r]) => id !== playerId && r === rosterId)
        .map(([id]) => playerAsset(id));
    // A commissioner can move a player straight between rosters: a drop by
    // one, then an add by the other.
    if (droppedBy !== undefined) {
      events.push({ kind: "dropped", at: at(t), year: t.year, via, byId: ownerIn(t.league_id, droppedBy), alongside: others(t.adds, droppedBy) });
    }
    if (addedTo !== undefined) {
      events.push({ kind: "added", at: at(t), year: t.year, via, byId: ownerIn(t.league_id, addedTo), alongside: others(t.drops, addedTo) });
    }
  }

  let currentOwnerId: string | null = null;
  const ownerIds = new Set<string>();
  const note = (id: string | null) => id && ownerIds.add(id);
  const noteAssets = (list: Asset[]) => list.forEach((a) => a.kind === "pick" && note(a.originalOwnerId));
  for (const e of events) {
    if (e.kind === "drafted") {
      currentOwnerId = e.byId;
      [e.byId, e.originalOwnerId].forEach(note);
      for (const l of e.pickTrades) {
        [l.fromId, l.toId].forEach(note);
        noteAssets(l.sentWith);
        noteAssets(l.receivedFor);
      }
    } else if (e.kind === "traded") {
      currentOwnerId = e.toId;
      [e.fromId, e.toId].forEach(note);
      noteAssets(e.sentWith);
      noteAssets(e.receivedFor);
    } else {
      currentOwnerId = e.kind === "added" ? e.byId : null;
      note(e.byId);
    }
  }

  return { events, currentOwnerId, ownerIds: [...ownerIds].sort() };
}

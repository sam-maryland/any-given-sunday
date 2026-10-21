import { Asset } from "./playerHistory";
import { DraftPick, Player, Roster, Transaction } from "./types";

/**
 * What the players page shows before anyone has been searched for: the
 * league's latest moves, and three short lists that each send the reader to
 * a player page worth seeing.
 *
 * Sleeper names rosters, not users, and picks by the roster they were issued
 * to, so every roster is resolved through the rosters of the league the move
 * was made in. Pure and I/O-free; the API handler does the loading.
 */

export type RecentMove =
  | {
      kind: "trade";
      id: string;
      at: string;
      /** What each owner came away with. */
      sides: { ownerId: string | null; gets: Asset[] }[];
    }
  | {
      kind: "pickup";
      id: string;
      at: string;
      via: "waiver" | "free_agent" | "commissioner";
      ownerId: string | null;
      added: Asset[];
      /** Let go in the same move to make room. */
      dropped: Asset[];
    };

/** A drafted player whose pick changed hands more than once first. */
export interface PickTrail {
  player: PlayerRef;
  year: number;
  startup: boolean;
  round: number;
  pickInRound: number;
  /** Every owner the pick belonged to, from the one it was issued to through the one who used it. */
  ownerIds: (string | null)[];
}

/** A startup pick who has never been traded, dropped or claimed. */
export interface Lifer {
  player: PlayerRef;
  round: number;
  pickInRound: number;
  ownerId: string | null;
}

/** A player who has been on the most rosters. */
export interface Journeyman {
  player: PlayerRef;
  owners: number;
  trades: number;
  pickups: number;
}

export interface PlayerRef {
  id: string;
  name: string;
  position: string | null;
}

export interface PlayerHighlights {
  recent: RecentMove[];
  pickTrails: PickTrail[];
  lifers: {
    year: number | null;
    /** Startup picks still with the owner who drafted them. */
    count: number;
    /** Of all startup picks. */
    of: number;
    /** The owner with the most, when one has more than anyone else. */
    leader: { ownerId: string; count: number } | null;
    /** The earliest picks among them. */
    players: Lifer[];
  };
  journeymen: Journeyman[];
  /** Every owner the lists mention, for the caller to name. */
  ownerIds: string[];
}

export interface PlayerHighlightsInput {
  transactions: Transaction[];
  draftPicks: DraftPick[];
  rosters: Roster[];
  players: Map<string, Player>;
  /** The startup draft's season: every later draft is a rookie draft. */
  startupYear: number | null;
  /** How many of each list to return. */
  limit?: number;
  /** How many recent moves to return. */
  recentLimit?: number;
}

const at = (t: Transaction) => t.completed_at ?? t.created_at;
const slotKey = (year: number, round: number, originalRosterId: number) => `${year}:${round}:${originalRosterId}`;

// A journeyman needs more than the two owners anyone dropped once has had.
const MIN_JOURNEYMAN_OWNERS = 3;
// One trade is a deal; a trail is a pick that kept moving.
const MIN_TRAIL_TRADES = 2;

export function buildPlayerHighlights(input: PlayerHighlightsInput): PlayerHighlights {
  const limit = input.limit ?? 5;
  const recentLimit = input.recentLimit ?? 10;

  const owners = new Map<string, string>();
  const teams = new Map<string, number>();
  for (const r of input.rosters) {
    owners.set(`${r.league_id}:${r.roster_id}`, r.user_id);
    teams.set(r.league_id, (teams.get(r.league_id) ?? 0) + 1);
  }
  const ownerIn = (leagueId: string, rosterId: number | undefined) =>
    rosterId === undefined ? null : (owners.get(`${leagueId}:${rosterId}`) ?? null);
  const pickInRound = (p: DraftPick) => {
    const size = teams.get(p.league_id) ?? 0;
    return size ? ((p.pick_no - 1) % size) + 1 : p.draft_slot;
  };

  const madeBySlot = new Map<string, DraftPick>();
  for (const p of input.draftPicks) madeBySlot.set(slotKey(p.year, p.round, p.original_roster_id), p);

  const ref = (id: string, fallback?: DraftPick): PlayerRef => {
    const p = input.players.get(id);
    return { id, name: p?.name ?? fallback?.player_name ?? `Player ${id}`, position: p?.position ?? fallback?.position ?? null };
  };
  const playerAsset = (id: string): Asset => ({ kind: "player", ...ref(id) });

  const complete = input.transactions
    .filter((t) => t.status === "complete")
    .sort((a, b) => at(a).localeCompare(at(b)) || a.id.localeCompare(b.id));

  // ---------- Recent moves ----------

  const recent: RecentMove[] = [];
  for (const t of [...complete].reverse()) {
    if (recent.length >= recentLimit) break;
    if (t.type === "trade") {
      const gets = new Map<number, Asset[]>(t.roster_ids.map((r) => [r, []]));
      const to = (rosterId: number) => gets.get(rosterId) ?? gets.set(rosterId, []).get(rosterId)!;
      for (const [id, rosterId] of Object.entries(t.adds ?? {})) to(rosterId).push(playerAsset(id));
      for (const p of t.draft_picks ?? []) {
        const made = madeBySlot.get(slotKey(Number(p.season), p.round, p.roster_id));
        to(p.owner_id).push({
          kind: "pick",
          season: p.season,
          round: p.round,
          originalOwnerId: ownerIn(t.league_id, p.roster_id),
          became: made ? { id: made.player_id, name: ref(made.player_id, made).name } : null,
        });
      }
      recent.push({
        kind: "trade",
        id: t.id,
        at: at(t),
        sides: [...gets].map(([rosterId, assets]) => ({ ownerId: ownerIn(t.league_id, rosterId), gets: assets })),
      });
      continue;
    }
    // A drop with nothing added is housekeeping, not news.
    const added = Object.keys(t.adds ?? {});
    if (added.length === 0) continue;
    const rosterId = t.adds![added[0]!]!;
    recent.push({
      kind: "pickup",
      id: t.id,
      at: at(t),
      via: t.type === "waiver" || t.type === "free_agent" ? t.type : "commissioner",
      ownerId: ownerIn(t.league_id, rosterId),
      added: added.filter((id) => t.adds![id] === rosterId).map(playerAsset),
      dropped: Object.entries(t.drops ?? {})
        .filter(([, r]) => r === rosterId)
        .map(([id]) => playerAsset(id)),
    });
  }

  // ---------- Pick trails ----------

  const pickMoves = new Map<string, { at: string; leagueId: string; from: number; to: number }[]>();
  for (const t of complete) {
    if (t.type !== "trade") continue;
    for (const p of t.draft_picks ?? []) {
      const key = slotKey(Number(p.season), p.round, p.roster_id);
      const list = pickMoves.get(key) ?? [];
      list.push({ at: at(t), leagueId: t.league_id, from: p.previous_owner_id, to: p.owner_id });
      pickMoves.set(key, list);
    }
  }

  const pickTrails: PickTrail[] = [];
  for (const pick of input.draftPicks) {
    const moves = pickMoves.get(slotKey(pick.year, pick.round, pick.original_roster_id)) ?? [];
    if (moves.length < MIN_TRAIL_TRADES) continue;
    const ownerIds: (string | null)[] = [ownerIn(pick.league_id, pick.original_roster_id)];
    for (const m of moves) ownerIds.push(ownerIn(m.leagueId, m.to));
    pickTrails.push({
      player: ref(pick.player_id, pick),
      year: pick.year,
      startup: pick.year === input.startupYear,
      round: pick.round,
      pickInRound: pickInRound(pick),
      ownerIds,
    });
  }
  // Longest first; among equals, the most recent draft, then the earliest pick.
  pickTrails.sort(
    (a, b) => b.ownerIds.length - a.ownerIds.length || b.year - a.year || a.round - b.round || a.pickInRound - b.pickInRound,
  );

  // ---------- Lifers ----------

  const moved = new Set<string>();
  const playerOwners = new Map<string, Set<string>>();
  const playerMoves = new Map<string, { trades: number; pickups: number }>();
  const noteOwner = (id: string, ownerId: string | null) => {
    if (!ownerId) return;
    const set = playerOwners.get(id) ?? new Set<string>();
    set.add(ownerId);
    playerOwners.set(id, set);
  };
  for (const t of complete) {
    for (const id of Object.keys(t.drops ?? {})) moved.add(id);
    for (const [id, to] of Object.entries(t.adds ?? {})) {
      moved.add(id);
      noteOwner(id, ownerIn(t.league_id, to));
      const counts = playerMoves.get(id) ?? { trades: 0, pickups: 0 };
      if (t.type === "trade") counts.trades++;
      else counts.pickups++;
      playerMoves.set(id, counts);
    }
  }
  for (const p of input.draftPicks) noteOwner(p.player_id, ownerIn(p.league_id, p.roster_id));

  const startupPicks = input.draftPicks.filter((p) => p.year === input.startupYear).sort((a, b) => a.pick_no - b.pick_no);
  const lifers = startupPicks.filter((p) => !moved.has(p.player_id));
  const byOwner = new Map<string, number>();
  for (const p of lifers) {
    const o = ownerIn(p.league_id, p.roster_id);
    if (o) byOwner.set(o, (byOwner.get(o) ?? 0) + 1);
  }
  const ranked = [...byOwner].sort((a, b) => b[1] - a[1]);
  const leader = ranked[0] && ranked[0][1] > (ranked[1]?.[1] ?? 0) ? { ownerId: ranked[0][0], count: ranked[0][1] } : null;

  // ---------- Journeymen ----------

  const journeymen: Journeyman[] = [...playerOwners]
    .filter(([, set]) => set.size >= MIN_JOURNEYMAN_OWNERS)
    .map(([id, set]) => ({ player: ref(id), owners: set.size, ...(playerMoves.get(id) ?? { trades: 0, pickups: 0 }) }))
    .sort(
      (a, b) =>
        b.owners - a.owners || b.trades - a.trades || b.trades + b.pickups - (a.trades + a.pickups) || a.player.name.localeCompare(b.player.name),
    )
    .slice(0, limit);

  // ---------- Owners to name ----------

  const result: Omit<PlayerHighlights, "ownerIds"> = {
    recent,
    pickTrails: pickTrails.slice(0, limit),
    lifers: {
      year: input.startupYear,
      count: lifers.length,
      of: startupPicks.length,
      leader,
      players: lifers.slice(0, limit).map((p) => ({
        player: ref(p.player_id, p),
        round: p.round,
        pickInRound: pickInRound(p),
        ownerId: ownerIn(p.league_id, p.roster_id),
      })),
    },
    journeymen,
  };

  const ownerIds = new Set<string>();
  const note = (id: string | null) => id && ownerIds.add(id);
  for (const m of result.recent) {
    if (m.kind === "trade") {
      for (const s of m.sides) {
        note(s.ownerId);
        for (const a of s.gets) if (a.kind === "pick") note(a.originalOwnerId);
      }
    } else {
      note(m.ownerId);
    }
  }
  result.pickTrails.forEach((t) => t.ownerIds.forEach(note));
  result.lifers.players.forEach((l) => note(l.ownerId));
  note(result.lifers.leader?.ownerId ?? null);

  return { ...result, ownerIds: [...ownerIds].sort() };
}

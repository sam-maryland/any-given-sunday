// The website's browser bundle (public/app.js): loads any Sleeper league and
// builds each page's data from it with the same code the Worker's /api
// endpoints use, so a page renders the same whichever it came from.

import { buildLeagueHistory } from "../domain/history";
import { LeagueType, formatOf } from "../domain/leagueFormat";
import {
  HistoryPayload,
  PlayerHighlightsPayload,
  PlayerPayload,
  PlayoffRacePayload,
  StandingsPayload,
  playoffRacePayload,
  standingsPayload,
} from "../domain/payloads";
import { buildPlayerHighlights } from "../domain/playerHighlights";
import { buildPlayerHistory, lookupsFor } from "../domain/playerHistory";
import { standingsForLeague } from "../domain/standings";
import { DraftPick, League, LeagueStatus, Player, Transaction, User, UserMap } from "../domain/types";
import { LeagueData, LeagueNotFoundError, LoadProgress, SeasonData, loadLeague, parseLeagueId } from "./league";

export { LeagueNotFoundError, loadLeague, parseLeagueId };
export type { LeagueData, LoadProgress };

// The page shows the first few and reveals the rest on request.
const RECENT_MOVES = 30;

/** What every page header needs to know about the league. */
export interface LeagueInfo {
  id: string;
  /** The league's first season's id: unlike the current one, it never changes. */
  firstSeasonId: string;
  name: string;
  /** Sleeper avatar URL, if the league has one. */
  avatar: string | null;
  type: LeagueType;
  /** The first season: a dynasty league's startup draft. */
  firstYear: number;
  /** Seasons with standings, newest first. */
  seasons: number[];
  /** Divisions the league has; the standings do not use them yet. */
  divisions: number;
}

export function leagueInfo(data: LeagueData): LeagueInfo {
  const newest = data.seasons[0]!;
  return {
    id: data.id,
    firstSeasonId: data.seasons[data.seasons.length - 1]!.league.id,
    name: data.name,
    avatar: data.avatar ? `https://sleepercdn.com/avatars/thumbs/${data.avatar}` : null,
    type: formatOf(newest.league).type,
    firstYear: data.seasons[data.seasons.length - 1]!.league.year,
    seasons: started(data).map((s) => s.league.year),
    divisions: newest.divisions,
  };
}

/** Seasons with games, newest first. A season not yet drafted has none. */
function started(data: LeagueData): SeasonData[] {
  return data.seasons.filter((s) => s.league.status !== LeagueStatus.Pending);
}

/**
 * Every owner who has played in the league. Each goes by their name and team
 * name in the newest season they played, so a team reads the same on every
 * page and an owner who left keeps the name they last had.
 */
function owners(data: LeagueData): { users: UserMap; labels: Map<string, string> } {
  const users: UserMap = new Map();
  const labels = new Map<string, string>();
  for (const season of data.seasons) {
    for (const o of season.owners) {
      if (users.has(o.id)) continue;
      users.set(o.id, { id: o.id, name: o.name, discord_id: null, onboarding_complete: null, email: null } satisfies User);
      labels.set(o.id, o.label);
    }
  }
  return { users, labels };
}

function withLabels(data: LeagueData): UserMap {
  const { users, labels } = owners(data);
  return new Map([...users].map(([id, u]) => [id, { ...u, name: labels.get(id) ?? u.name }]));
}

function syncedAt(data: LeagueData): Date {
  return new Date(Math.max(...data.seasons.map((s) => s.fetchedAt)));
}

// --- standings --------------------------------------------------------------

/**
 * One season's standings: the given year, else the season in progress, else
 * the latest finished one. Null when the league has not played a game yet.
 */
export function standingsFor(data: LeagueData, year?: number | null): StandingsPayload | null {
  const seasons = started(data);
  const season =
    (year ? seasons.find((s) => s.league.year === year) : undefined) ??
    seasons.find((s) => s.league.status === LeagueStatus.InProgress) ??
    seasons[0];
  if (!season) return null;
  return standingsPayload({
    league: season.league,
    matchups: season.matchups,
    result: standingsForLeague(season.league, season.matchups),
    users: withLabels(data),
    seasons: seasons.map((s) => s.league.year),
    syncedAt: new Date(season.fetchedAt),
  });
}

// --- playoff race -----------------------------------------------------------

export function playoffRaceFor(data: LeagueData): PlayoffRacePayload {
  const season = started(data).find((s) => s.league.status === LeagueStatus.InProgress);
  if (!season) return { active: false, reason: "no season in progress" };
  if (season.lastRegularWeek === null) {
    return { active: false, reason: "the league does not say when its playoffs start" };
  }
  if (season.remaining.length === 0) return { active: false, reason: "the regular season is over" };
  return playoffRacePayload({
    league: season.league,
    played: season.matchups,
    remaining: season.remaining,
    lastRegularWeek: season.lastRegularWeek,
    syncedAt: new Date(season.fetchedAt),
  });
}

// --- history ----------------------------------------------------------------

export function historyFor(data: LeagueData): HistoryPayload {
  const seasons = [...started(data)].reverse();
  const { users, labels } = owners(data);
  const leagues: League[] = seasons.map((s) => s.league);
  return {
    ...buildLeagueHistory(
      leagues,
      seasons.flatMap((s) => s.matchups),
      users,
      labels,
      seasons.flatMap((s) => s.transactions),
      seasons.flatMap((s) => s.rosters),
    ),
    syncedAt: syncedAt(data).toISOString(),
  };
}

// --- players ----------------------------------------------------------------

/**
 * Names for every NFL player, served by the Worker from a weekly copy of
 * Sleeper's player list (whole, it is too big for each visitor to fetch).
 * Empty if that is unavailable: players are then named from the draft
 * boards, which covers every drafted player.
 */
export async function loadPlayerNames(): Promise<Map<string, Player>> {
  try {
    const res = await fetch("/api/nfl-players");
    if (!res.ok) return new Map();
    const rows = (await res.json()) as Record<string, [string, string | null, string | null]>;
    return new Map(Object.entries(rows).map(([id, [name, position, team]]) => [id, { id, name, position, team }]));
  } catch {
    return new Map();
  }
}

function allTransactions(data: LeagueData): Transaction[] {
  return data.seasons.flatMap((s) => s.transactions);
}

function allPicks(data: LeagueData): DraftPick[] {
  return data.seasons.flatMap((s) => s.draftPicks);
}

/** Player names, filled in from the draft boards where the list has none. */
function namesWith(names: Map<string, Player>, picks: DraftPick[]): Map<string, Player> {
  const merged = new Map(names);
  for (const p of picks) {
    if (!merged.has(p.player_id)) {
      merged.set(p.player_id, { id: p.player_id, name: p.player_name, position: p.position || null, team: null, teamUnknown: true });
    }
  }
  return merged;
}

/** Every player who has been through the league, by name, for the search box. */
export function playersFor(data: LeagueData, names: Map<string, Player>): Player[] {
  const ids = new Set<string>();
  for (const t of allTransactions(data)) {
    for (const id of Object.keys(t.adds ?? {})) ids.add(id);
    for (const id of Object.keys(t.drops ?? {})) ids.add(id);
  }
  const picks = allPicks(data);
  for (const p of picks) ids.add(p.player_id);
  const named = namesWith(names, picks);
  return [...ids]
    .map((id) => named.get(id))
    .filter((p): p is Player => !!p)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The draft year that counts as a startup draft: only a dynasty league has one. */
function startupYear(data: LeagueData): number | null {
  const info = leagueInfo(data);
  return info.type === "dynasty" ? info.firstYear : null;
}

function ownerNames(data: LeagueData, ownerIds: string[]): Record<string, { label: string; name: string }> {
  const { users, labels } = owners(data);
  return Object.fromEntries(
    ownerIds.map((id) => {
      const name = users.get(id)?.name || id;
      return [id, { label: labels.get(id) ?? name, name }];
    }),
  );
}

/**
 * Every transaction that moved a player, or a pick he was drafted with — the
 * same rule as the player_transactions database function.
 */
export function transactionsForPlayer(transactions: Transaction[], picks: DraftPick[], playerId: string): Transaction[] {
  const slots = new Set(
    picks.filter((p) => p.player_id === playerId).map((p) => `${p.year}:${p.round}:${p.original_roster_id}`),
  );
  return transactions.filter(
    (t) =>
      (t.adds && playerId in t.adds) ||
      (t.drops && playerId in t.drops) ||
      (t.type === "trade" &&
        t.status === "complete" &&
        t.draft_picks.some((p) => slots.has(`${Number(p.season)}:${p.round}:${p.roster_id}`))),
  );
}

/** One player's path through the league, or null if he was never in it. */
export function playerFor(data: LeagueData, playerId: string, names: Map<string, Player>): PlayerPayload | null {
  const picks = allPicks(data);
  const draftPicks = picks.filter((p) => p.player_id === playerId);
  const transactions = transactionsForPlayer(allTransactions(data), picks, playerId);
  if (draftPicks.length === 0 && transactions.length === 0) return null;

  const { pickSlots } = lookupsFor(transactions);
  const wanted = new Set(pickSlots.map((s) => `${s.year}:${s.round}:${s.originalRosterId}`));
  const pickResults = picks.filter((p) => wanted.has(`${p.year}:${p.round}:${p.original_roster_id}`));
  const players = namesWith(names, picks);

  const { ownerIds, ...built } = buildPlayerHistory({
    playerId,
    draftPicks,
    transactions,
    rosters: data.seasons.flatMap((s) => s.rosters),
    startupYear: startupYear(data),
    players,
    pickResults,
  });
  return {
    player: players.get(playerId) ?? { id: playerId, name: `Player ${playerId}`, position: null, team: null, teamUnknown: true },
    ...built,
    owners: ownerNames(data, ownerIds),
    syncedAt: syncedAt(data).toISOString(),
  };
}

export function highlightsFor(data: LeagueData, names: Map<string, Player>): PlayerHighlightsPayload {
  const picks = allPicks(data);
  const { ownerIds, ...built } = buildPlayerHighlights({
    transactions: allTransactions(data),
    draftPicks: picks,
    rosters: data.seasons.flatMap((s) => s.rosters),
    players: namesWith(names, picks),
    startupYear: startupYear(data),
    recentLimit: RECENT_MOVES,
  });
  return { ...built, owners: ownerNames(data, ownerIds), syncedAt: syncedAt(data).toISOString() };
}

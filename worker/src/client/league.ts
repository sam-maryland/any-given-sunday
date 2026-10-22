// Loads a whole league, every season of it, straight from Sleeper's public
// API in the visitor's browser, and turns it into the same rows the rest of
// the site is built from. Nothing is stored server-side: finished seasons
// are kept in the visitor's IndexedDB (see cache.ts), since they never change.

import type {
  NFLState,
  SleeperBracketMatch,
  SleeperDraft,
  SleeperDraftPick,
  SleeperGame,
  SleeperLeague,
  SleeperMatchup,
  SleeperRoster,
  SleeperTransaction,
  SleeperUser,
} from "../data/sleeper";
import { formatFromSleeper } from "../domain/leagueFormat";
import type { Pairing } from "../domain/playoffRace";
import {
  bracketGamesFrom,
  groupIntoHeadToHead,
  lastCompletedWeek,
  playoffOutcome,
  playoffRow,
} from "../domain/sleeperMatchups";
import { matchupsToStandingsMap, sortStandingsMap } from "../domain/standings";
import { DraftPick, League, LeagueStatus, NewMatchup, Roster, Transaction } from "../domain/types";
import { draftPickRows, transactionRow, LAST_TRANSACTION_WEEK } from "../recap/activity";
import { cacheGet, cachePut } from "./cache";

const API = "https://api.sleeper.app";

// Bump whenever SeasonData or the way it is built changes, so no visitor is
// served a season cached by older code.
const SEASON_VERSION = 1;

// How long a season still being played is reused before Sleeper is asked
// again. Long enough that clicking between pages costs nothing.
const LIVE_TTL_MS = 15 * 60 * 1000;

// Sleeper asks for under 1000 requests a minute. A first visit is about 40
// a season, so even an eight-season league stays well under that; requests
// are latency-bound, so more in flight is what makes that first visit quick.
const MAX_IN_FLIGHT = 20;

/** One owner as Sleeper named them in a season. */
export interface SeasonOwner {
  id: string;
  /** Sleeper username. */
  name: string;
  /** Team name, else username: what the site calls them. */
  label: string;
  avatar: string | null;
}

/** One season of a league, in the rows the site is built from. */
export interface SeasonData {
  version: number;
  /** When it was read from Sleeper, epoch ms. */
  fetchedAt: number;
  /** Sleeper's status when it was read: only a "complete" read is final. */
  sleeperStatus: string;
  /** With its format and, once complete, its podium and playoff outcome. */
  league: League;
  /** League name that season. */
  name: string;
  /** Finished games only: the regular season, then the playoffs. */
  matchups: NewMatchup[];
  /** Regular season pairings still to be played; empty once the season is over. */
  remaining: Pairing[];
  /** The last regular season week, or null when Sleeper does not say. */
  lastRegularWeek: number | null;
  transactions: Transaction[];
  draftPicks: DraftPick[];
  rosters: Roster[];
  owners: SeasonOwner[];
  /** Divisions the league plays in; the standings ignore them for now. */
  divisions: number;
}

/** Every season of a league, newest first. */
export interface LeagueData {
  /** The id the visitor gave: the league's current season. */
  id: string;
  name: string;
  avatar: string | null;
  seasons: SeasonData[];
}

export class LeagueNotFoundError extends Error {}

// --- requests -------------------------------------------------------------

let inFlight = 0;
const waiting: (() => void)[] = [];

async function slot<T>(run: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight++;
  try {
    return await run();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

/** A GET with one retry, since a cold load is a couple of hundred requests. */
async function get<T>(path: string): Promise<T> {
  return slot(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`${API}${path}`, { headers: { Accept: "application/json" } });
        if (res.ok) return (await res.json()) as T;
        if (res.status < 500 || attempt > 0) throw new Error(`Sleeper GET ${path} failed (${res.status})`);
      } catch (err) {
        if (attempt > 0) throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });
}

// --- the league chain -----------------------------------------------------

/** Sleeper's league status as the site's: only a season with games has standings. */
export function leagueStatus(sleeperStatus: string): string {
  switch (sleeperStatus) {
    case "complete":
      return LeagueStatus.Complete;
    case "in_season":
    case "post_season":
      return LeagueStatus.InProgress;
    default:
      return LeagueStatus.Pending;
  }
}

/** Sleeper ids are long strings of digits. */
export function parseLeagueId(input: string): string | null {
  const match = input.trim().match(/(\d{10,24})/);
  return match ? match[1]! : null;
}

/**
 * The league's seasons from the given one back to its first, newest first,
 * following each season's previous_league_id. A finished season's league
 * never changes, so it comes from the cache when it can.
 */
export async function loadChain(leagueId: string): Promise<SleeperLeague[]> {
  const chain: SleeperLeague[] = [];
  const seen = new Set<string>();
  let id: string | null | undefined = leagueId;
  while (id && id !== "0" && !seen.has(id)) {
    seen.add(id);
    const key: string = `league:${id}`;
    let league: SleeperLeague | null = await cacheGet<SleeperLeague>(key);
    if (!league) {
      league = await get<SleeperLeague | null>(`/v1/league/${encodeURIComponent(id)}`);
      if (!league) {
        if (chain.length === 0) throw new LeagueNotFoundError(`no Sleeper league ${id}`);
        break;
      }
      if (league.status === "complete") await cachePut(key, league);
    }
    chain.push(league);
    id = league.previous_league_id;
  }
  return chain;
}

// --- one season -----------------------------------------------------------

/** What is known about the NFL calendar right now, for a season in progress. */
export interface NflClock {
  state: NFLState;
  schedule: SleeperGame[];
}

async function loadClock(): Promise<NflClock> {
  const state = await get<NFLState>("/v1/state/nfl");
  // Outside Sleeper's documented API, so losing it only costs precision.
  const schedule = await get<SleeperGame[]>(`/schedule/nfl/regular/${encodeURIComponent(state.season)}`).catch(() => []);
  return { state, schedule };
}

/** The last week of this season whose games are all over. */
export function lastCompleteWeekFor(league: SleeperLeague, clock: NflClock | null): number {
  if (league.status === "complete") return Infinity;
  const scored = league.settings?.last_scored_leg;
  if (!clock || clock.state.season !== league.season) return scored ?? 0;
  return lastCompletedWeek(clock.schedule, scored ?? clock.state.week - 1);
}

/**
 * A roster nobody owns still plays games. It is named after the season and
 * roster, so it never merges with a real owner's history.
 */
function orphanId(league: SleeperLeague, rosterId: number): string {
  return `orphan-${league.season}-${rosterId}`;
}

export async function loadSeason(
  league: SleeperLeague,
  firstSeasonId: string,
  clock: NflClock | null,
): Promise<SeasonData> {
  const year = Number(league.season);
  const status = leagueStatus(league.status);
  const format = formatFromSleeper(league.settings ?? {}, firstSeasonId);
  const id = encodeURIComponent(league.league_id);

  const [users, sleeperRosters] = await Promise.all([
    get<SleeperUser[]>(`/v1/league/${id}/users`),
    get<SleeperRoster[]>(`/v1/league/${id}/rosters`),
  ]);
  const rosterToOwner = new Map(sleeperRosters.map((r) => [r.roster_id, r.owner_id || orphanId(league, r.roster_id)]));

  const owners: SeasonOwner[] = users.map((u) => ({
    id: u.user_id,
    name: u.display_name,
    label: u.metadata?.team_name || u.display_name,
    avatar: u.avatar ?? null,
  }));
  for (const r of sleeperRosters) {
    if (!r.owner_id) {
      const name = `Team ${r.roster_id} (no owner)`;
      owners.push({ id: orphanId(league, r.roster_id), name, label: name, avatar: null });
    }
  }

  const base: SeasonData = {
    version: SEASON_VERSION,
    fetchedAt: Date.now(),
    sleeperStatus: league.status,
    league: {
      id: league.league_id,
      year,
      status,
      first_place: "",
      second_place: "",
      third_place: "",
      format,
      playoffOutcome: null,
    },
    name: league.name ?? "",
    matchups: [],
    remaining: [],
    lastRegularWeek: null,
    transactions: [],
    draftPicks: [],
    // Orphaned rosters included: their trades still need an owner to name,
    // and the draft board still has their column.
    rosters: sleeperRosters.map((r) => ({
      league_id: league.league_id,
      roster_id: r.roster_id,
      user_id: rosterToOwner.get(r.roster_id)!,
    })),
    owners,
    divisions: league.settings?.divisions ?? 0,
  };

  const [games, transactions, draftPicks] = await Promise.all([
    status === LeagueStatus.Pending ? null : loadGames(league, rosterToOwner, format, clock),
    loadTransactions(league, year),
    loadDraft(league, year),
  ]);
  return { ...base, ...games, league: { ...base.league, ...games?.league }, transactions, draftPicks };
}

async function loadGames(
  league: SleeperLeague,
  rosterToOwner: Map<number, string>,
  format: ReturnType<typeof formatFromSleeper>,
  clock: NflClock | null,
): Promise<Pick<SeasonData, "matchups" | "remaining" | "lastRegularWeek"> & { league: Partial<League> }> {
  const id = encodeURIComponent(league.league_id);
  const year = Number(league.season);
  const lastComplete = lastCompleteWeekFor(league, clock);
  const playoffStart = league.settings?.playoff_week_start;
  const lastRegularWeek = typeof playoffStart === "number" && playoffStart > 1 ? playoffStart - 1 : null;
  // Without a playoff start, every week Sleeper has scored is regular season.
  const regularWeeks = lastRegularWeek ?? Math.min(lastComplete, LAST_TRANSACTION_WEEK);

  const weeks = Array.from({ length: Math.max(0, regularWeeks) }, (_, i) => i + 1);
  const byWeek = await Promise.all(weeks.map((w) => get<SleeperMatchup[]>(`/v1/league/${id}/matchups/${w}`)));

  const matchups: NewMatchup[] = [];
  const remaining: Pairing[] = [];
  byWeek.forEach((rows, i) => {
    const week = i + 1;
    for (const m of groupIntoHeadToHead(rows ?? [], rosterToOwner, year, week)) {
      if (week <= lastComplete) matchups.push(m);
      else remaining.push({ week, homeId: m.home_user_id, awayId: m.away_user_id });
    }
  });

  const result = { matchups, remaining, lastRegularWeek, league: {} as Partial<League> };
  if (lastRegularWeek === null || lastComplete <= lastRegularWeek) return result;

  // The playoffs: the bracket says which games are decided and which weeks
  // they were played over; their scores come from those weeks' matchups.
  const bracket = await get<SleeperBracketMatch[]>(`/v1/league/${id}/winners_bracket`).catch(() => []);
  const playoffs = { weekStart: playoffStart!, roundType: league.settings.playoff_round_type ?? 0 };
  const bracketGames = bracketGamesFrom(bracket ?? [], playoffs, lastComplete);
  const playoffWeeks = [...new Set(bracketGames.flatMap((g) => g.weeks))].sort((a, b) => a - b);
  const pointsByWeek = new Map<number, Map<number, number>>();
  await Promise.all(
    playoffWeeks.map(async (w) => {
      const rows = await get<SleeperMatchup[]>(`/v1/league/${id}/matchups/${w}`);
      pointsByWeek.set(w, new Map((rows ?? []).map((r) => [r.roster_id, r.points])));
    }),
  );

  const seeds = new Map(
    sortStandingsMap(matchupsToStandingsMap(matchups, format.medianGame), format.tiebreaker === "headToHead").map(
      (s, i) => [s.userId, i + 1],
    ),
  );
  for (const game of bracketGames) {
    if (!game.weeks.every((w) => pointsByWeek.has(w))) continue;
    const row = playoffRow(game, pointsByWeek, rosterToOwner, seeds, year);
    if (row) matchups.push(row);
  }

  // Sleeper marks a league complete once its final is decided; until then
  // there is no podium to show.
  if (league.status === "complete") {
    const outcome = playoffOutcome(bracket ?? [], rosterToOwner);
    if (outcome) {
      const at = (place: number) => outcome.find((p) => p.place === place)?.userId ?? "";
      result.league = { playoffOutcome: outcome, first_place: at(1), second_place: at(2), third_place: at(3) };
    }
  }
  return result;
}

async function loadTransactions(league: SleeperLeague, year: number): Promise<Transaction[]> {
  const id = encodeURIComponent(league.league_id);
  const weeks = Array.from({ length: LAST_TRANSACTION_WEEK }, (_, i) => i + 1);
  const byWeek = await Promise.all(weeks.map((w) => get<SleeperTransaction[]>(`/v1/league/${id}/transactions/${w}`)));
  return byWeek.flatMap((rows) => (rows ?? []).map((tx) => transactionRow(tx, league.league_id, year)));
}

async function loadDraft(league: SleeperLeague, year: number): Promise<DraftPick[]> {
  if (!league.draft_id) return [];
  const id = encodeURIComponent(league.draft_id);
  const draft = await get<SleeperDraft | null>(`/v1/draft/${id}`);
  if (!draft || draft.status !== "complete") return [];
  const picks = await get<SleeperDraftPick[]>(`/v1/draft/${id}/picks`);
  const rows = draftPickRows(draft, picks ?? [], league.league_id, year);
  return rows.map((row, i) => (picks[i]?.is_keeper ? { ...row, is_keeper: true } : row));
}

// --- the whole league -----------------------------------------------------

export interface LoadProgress {
  done: number;
  total: number;
}

/**
 * Every season of the league, newest first. Finished seasons come from the
 * cache when they are there; the one in progress is reused for a few minutes.
 */
export async function loadLeague(
  leagueId: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<LeagueData> {
  const chain = await loadChain(leagueId);
  const firstSeasonId = chain[chain.length - 1]!.league_id;
  const live = chain.some((l) => l.status !== "complete" && leagueStatus(l.status) !== LeagueStatus.Pending);
  const clock = live ? await loadClock().catch(() => null) : null;

  let done = 0;
  onProgress?.({ done, total: chain.length });
  const seasons = await Promise.all(
    chain.map(async (league) => {
      const key = `season:${league.league_id}:${SEASON_VERSION}`;
      const cached = await cacheGet<SeasonData>(key);
      const fresh =
        cached &&
        cached.version === SEASON_VERSION &&
        (cached.sleeperStatus === "complete" || Date.now() - cached.fetchedAt < LIVE_TTL_MS);
      const season = fresh ? cached : await loadSeason(league, firstSeasonId, clock);
      if (!fresh) await cachePut(key, season);
      onProgress?.({ done: ++done, total: chain.length });
      return season;
    }),
  );

  return {
    id: leagueId,
    name: chain[0]!.name ?? "",
    avatar: chain[0]!.avatar ?? null,
    seasons,
  };
}

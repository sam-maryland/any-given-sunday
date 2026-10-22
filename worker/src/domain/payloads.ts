// The JSON the website's pages are built from. The Worker's /api endpoints
// send these (for Any Given Sunday, from Supabase), and the browser builds
// the same shapes for any league straight from Sleeper (src/client/site.ts).
// Pure: no I/O, no Workers-only APIs, so both can bundle it.

import { LeagueHistory } from "./history";
import { AGS_FORMAT, LeagueFormat, formatOf } from "./leagueFormat";
import { PlayerHighlights } from "./playerHighlights";
import { PlayerHistory } from "./playerHistory";
import { Pairing } from "./playoffRace";
import { LeagueStandings, RankExplanation, Finish } from "./standings";
import { League, LeagueStatus, NewMatchup, Player, UserMap } from "./types";

// --- standings --------------------------------------------------------------

export interface GameRow {
  week: number;
  opponentId: string;
  pointsFor: number;
  pointsAgainst: number;
  result: "W" | "L" | "T";
  /** The playoff round, for a playoff game. */
  playoffRound: string | null;
}

export interface StandingsRow {
  rank: number;
  userId: string;
  /** Sleeper team name, falling back to the stored user name. */
  name: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Regular season rank: the playoff seed for the top six. */
  seed: number;
  /** Why this team is directly above the next one; null for last place. */
  aheadOfNext: RankExplanation["aheadOfNext"];
  /** The regular season win tie this team was part of, if any. */
  tie: RankExplanation["tie"];
  /** How a completed season ended, when playoff results set the order. */
  finish: Finish | null;
  /** Every game this season in week order, playoffs included. */
  games: GameRow[];
}

export interface StandingsPayload {
  year: number;
  status: string;
  /**
   * False when a COMPLETE season's order is regular season record only,
   * because its playoff matchups are missing. The dashboard shows the same
   * caveat the Discord command does.
   */
  usedPlayoffResults: boolean;
  /** Teams above this index are in playoff position, while a season is live. */
  playoffCutoff: number | null;
  /** Teams that make the playoffs, live or not. */
  playoffTeams: number;
  /** The last place a placement game settles; null when they all do. */
  placementGamesThrough: number | null;
  /** Seeds at or above this get a first-round bye. */
  byeCutoff: number;
  /** How teams level on wins were ordered. */
  tiebreaker: LeagueFormat["tiebreaker"];
  /**
   * True when the regular season order is Sleeper's own standings; false when
   * the site ranked the teams itself (a custom league, or Sleeper had none).
   */
  sleeperOrder: boolean;
  /** Whether records include a game against each week's median score. */
  medianGame: boolean;
  /** The latest week with a synced game, or null before week 1 lands. */
  throughWeek: number | null;
  /** When the weekly sync this data reflects ran, as an ISO timestamp. */
  syncedAt: string;
  /** Seasons with standings, newest first, for the season picker. */
  seasons: number[];
  standings: StandingsRow[];
}

export interface PayloadInput {
  league: League;
  matchups: NewMatchup[];
  result: LeagueStandings;
  users: UserMap;
  seasons: number[];
  syncedAt: Date;
}

// Any Given Sunday's byes, for callers that only serve that league.
export const BYE_SEEDS = AGS_FORMAT.byes;

function gamesByUser(matchups: NewMatchup[]): Map<string, GameRow[]> {
  const games = new Map<string, GameRow[]>();
  const add = (userId: string, game: GameRow) => {
    const list = games.get(userId);
    if (list) list.push(game);
    else games.set(userId, [game]);
  };
  const outcome = (mine: number, theirs: number): GameRow["result"] =>
    mine > theirs ? "W" : mine < theirs ? "L" : "T";

  for (const m of [...matchups].sort((a, b) => a.week - b.week)) {
    const playoffRound = m.is_playoff ? m.playoff_round : null;
    add(m.home_user_id, {
      week: m.week,
      opponentId: m.away_user_id,
      pointsFor: round1(m.home_score),
      pointsAgainst: round1(m.away_score),
      result: outcome(m.home_score, m.away_score),
      playoffRound,
    });
    add(m.away_user_id, {
      week: m.week,
      opponentId: m.home_user_id,
      pointsFor: round1(m.away_score),
      pointsAgainst: round1(m.home_score),
      result: outcome(m.away_score, m.home_score),
      playoffRound,
    });
  }
  return games;
}

// The browser-facing view of the same standings the /standings command posts,
// plus the working behind them: the dashboard explains each team's place.
export function standingsPayload(input: PayloadInput): StandingsPayload {
  const { league, matchups, result, users } = input;
  const format = formatOf(league);
  const games = gamesByUser(matchups);
  const weeks = matchups.map((m) => m.week);

  return {
    year: league.year,
    status: league.status,
    usedPlayoffResults: result.usedPlayoffResults,
    playoffCutoff: league.status === LeagueStatus.InProgress ? format.playoffTeams : null,
    playoffTeams: format.playoffTeams,
    placementGamesThrough: format.placementGamesThrough,
    byeCutoff: format.byes,
    tiebreaker: format.tiebreaker,
    sleeperOrder: format.standings === "sleeper" && !!league.sleeperRanks,
    medianGame: format.medianGame,
    throughWeek: weeks.length > 0 ? Math.max(...weeks) : null,
    syncedAt: input.syncedAt.toISOString(),
    seasons: input.seasons,
    standings: result.standings.map((s, i) => {
      const why = result.explanations[i]!;
      return {
        rank: i + 1,
        userId: s.userId,
        name: users.get(s.userId)?.name || s.userId,
        wins: s.wins,
        losses: s.losses,
        ties: s.ties,
        // Raw sums carry float noise from summing scores; round to the one
        // decimal place fantasy scoring actually has.
        pointsFor: round1(s.pointsFor),
        pointsAgainst: round1(s.pointsAgainst),
        seed: why.seed,
        aheadOfNext: why.aheadOfNext,
        tie: why.tie,
        finish: why.finish,
        games: games.get(s.userId) ?? [],
      };
    }),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// --- playoff race -----------------------------------------------------------

/** A regular season game already played, at full scoring precision. */
export interface PlayedGame {
  week: number;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
}

export type PlayoffRacePayload =
  | { active: false; reason: string }
  | {
      active: true;
      year: number;
      /** The latest synced regular season week, or 0 before week 1 lands. */
      throughWeek: number;
      lastRegularWeek: number;
      playoffTeams: number;
      byeTeams: number;
      /** The league's tiebreaker and median rule, for the simulation. */
      useHeadToHead: boolean;
      medianGame: boolean;
      /**
       * Played games with unrounded scores. The standings payload rounds to
       * one decimal for display, which is not precise enough to settle a
       * points-for tiebreak the way the real standings do.
       */
      played: PlayedGame[];
      remaining: Pairing[];
      syncedAt: string;
    };

export interface PlayoffRaceInput {
  league: League;
  /** Every game of the season so far; playoff games are ignored. */
  played: NewMatchup[];
  remaining: Pairing[];
  lastRegularWeek: number;
  syncedAt: Date;
}

export function playoffRacePayload(input: PlayoffRaceInput): PlayoffRacePayload {
  const format = formatOf(input.league);
  const played = input.played.filter((m) => !m.is_playoff);
  return {
    active: true,
    year: input.league.year,
    throughWeek: played.reduce((max, m) => Math.max(max, m.week), 0),
    lastRegularWeek: input.lastRegularWeek,
    playoffTeams: format.playoffTeams,
    byeTeams: format.byes,
    useHeadToHead: format.tiebreaker === "headToHead",
    medianGame: format.medianGame,
    played: played.map((m) => ({
      week: m.week,
      homeId: m.home_user_id,
      awayId: m.away_user_id,
      homeScore: m.home_score,
      awayScore: m.away_score,
    })),
    remaining: input.remaining,
    syncedAt: input.syncedAt.toISOString(),
  };
}

// --- players -----------------------------------------------------------------

export interface PlayerPayload extends Omit<PlayerHistory, "ownerIds"> {
  player: Player;
  /**
   * Every owner the events mention, by user id: the name to show (their
   * current Sleeper team name, else Sleeper username, else their own name)
   * and their own name, for a hover.
   */
  owners: Record<string, { label: string; name: string }>;
  syncedAt: string;
}

export interface PlayerHighlightsPayload extends Omit<PlayerHighlights, "ownerIds"> {
  /** Every owner the lists mention, named as in PlayerPayload. */
  owners: Record<string, { label: string; name: string }>;
  syncedAt: string;
}

export interface PlayersPayload {
  /** Everyone who has been through the league, by name. */
  players: Player[];
  syncedAt: string;
}

// --- history -----------------------------------------------------------------

export interface HistoryPayload extends LeagueHistory {
  syncedAt: string;
}

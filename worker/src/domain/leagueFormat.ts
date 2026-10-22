import type { League } from "./types";

/** Sleeper's settings.type: 0 redraft, 1 keeper, 2 dynasty. */
export type LeagueType = "redraft" | "keeper" | "dynasty";

/** What the league pays, in whole dollars. */
export interface Payouts {
  buyIn: number;
  weeklyHighScore: number;
  /** By finishing place: [first, second, third, ...]. */
  places: number[];
}

/**
 * How one season of a league is run: everything the standings and history
 * need that differs from league to league.
 */
export interface LeagueFormat {
  type: LeagueType;
  /**
   * Whose regular season order the standings show. "sleeper" is Sleeper's own
   * standings, read from Sleeper, so the site always agrees with the app.
   * "custom" is the site's own tiebreakers, for a league whose rules Sleeper
   * does not support.
   */
  standings: "sleeper" | "custom";
  /** Teams that make the playoffs; standings draw a cut line here in season. */
  playoffTeams: number;
  /** Top seeds that skip the first playoff round. */
  byes: number;
  /**
   * How teams level on wins are ordered. "pointsFor" is Sleeper's own rule,
   * and the fallback when Sleeper's standings are unavailable; "headToHead"
   * is Any Given Sunday's (see docs/standings-calculation.md).
   */
  tiebreaker: "headToHead" | "pointsFor";
  /** Each team also plays the weekly median (Sleeper's league_average_match). */
  medianGame: boolean;
  /**
   * How many divisions the league plays in; 0 without. Sleeper sends every
   * division winner to the playoffs, whatever its record.
   */
  divisions: number;
  /**
   * The last place a placement game settles. Below it, playoff teams that
   * went out in the same round are ordered by the tiebreakers instead. Null
   * when every placement game counts, as on Sleeper.
   */
  placementGamesThrough: number | null;
  /** Null when the site does not know what the league pays. */
  payouts: Payouts | null;
}

export const AGS_PAYOUTS: Payouts = {
  buyIn: 100,
  weeklyHighScore: 15,
  places: [600, 300, 120],
};

/**
 * Any Given Sunday's format, unchanged since it started in 2023. The default
 * for a league with no format of its own, which is every league read from
 * Supabase: the Discord bot and the weekly recap only ever see this one.
 */
export const AGS_FORMAT: LeagueFormat = {
  type: "dynasty",
  standings: "custom",
  playoffTeams: 6,
  byes: 2,
  tiebreaker: "headToHead",
  medianGame: false,
  divisions: 0,
  // The final and the third place game. The quarterfinal losers play a fifth
  // place game on Sleeper, but the league orders them by tiebreakers.
  placementGamesThrough: 4,
  payouts: AGS_PAYOUTS,
};

/**
 * Settings Sleeper cannot tell us, keyed by the league's first season's id —
 * a league gets a new id every season, but its first one never changes.
 */
const OVERRIDES: Record<string, Partial<LeagueFormat>> = {
  // Any Given Sunday
  "996999191685566464": { standings: "custom", tiebreaker: "headToHead", placementGamesThrough: 4, payouts: AGS_PAYOUTS },
};

/** The part of Sleeper's league settings the format is read from. */
export interface SleeperFormatSettings {
  type?: number;
  playoff_teams?: number;
  league_average_match?: number;
  divisions?: number | null;
}

/**
 * Seeds that skip round one: a bracket fills up to the next power of two, so
 * 6 teams give the top 2 a bye and 4 or 8 give none.
 */
export function byesFor(playoffTeams: number): number {
  if (playoffTeams < 2) return 0;
  let size = 1;
  while (size < playoffTeams) size *= 2;
  return size - playoffTeams;
}

export function formatFromSleeper(settings: SleeperFormatSettings, firstSeasonId: string): LeagueFormat {
  const playoffTeams = settings.playoff_teams ?? 6;
  const type: LeagueType = settings.type === 2 ? "dynasty" : settings.type === 1 ? "keeper" : "redraft";
  return {
    type,
    standings: "sleeper",
    playoffTeams,
    byes: byesFor(playoffTeams),
    tiebreaker: "pointsFor",
    medianGame: settings.league_average_match === 1,
    divisions: settings.divisions ?? 0,
    placementGamesThrough: null,
    payouts: null,
    ...OVERRIDES[firstSeasonId],
  };
}

export function formatOf(league: Pick<League, "format">): LeagueFormat {
  return league.format ?? AGS_FORMAT;
}

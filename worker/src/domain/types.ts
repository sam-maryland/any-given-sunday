import type { LeagueFormat } from "./leagueFormat";

export const LeagueStatus = {
  InProgress: "IN_PROGRESS",
  Complete: "COMPLETE",
  Pending: "PENDING",
} as const;

export const PlayoffRound = {
  Finals: "final",
  Semifinals: "semifinal",
  Quarterfinals: "quarterfinal",
  ThirdPlace: "third_place",
  /** Any round before the quarterfinals, in a bracket of more than 8 teams. */
  FirstRound: "first_round",
} as const;

/**
 * How a playoff team's season ended, read from Sleeper's bracket: `place` from
 * a placement game (the final is 1st and 2nd, the third place game 3rd and
 * 4th, and so on), else null with `lostIn` the round they went out in.
 */
export interface PlayoffPlace {
  userId: string;
  place: number | null;
  lostIn: string | null;
}

export interface League {
  id: string;
  year: number;
  first_place: string;
  second_place: string;
  third_place: string;
  status: string;
  /** How this season was run. Absent for leagues read from Supabase (AGS). */
  format?: LeagueFormat;
  /**
   * Every playoff team, best finish first, once the season is complete.
   * Absent for leagues read from Supabase, whose order comes from the stored
   * playoff matchups instead.
   */
  playoffOutcome?: PlayoffPlace[] | null;
  /**
   * Sleeper's own regular season standings, user id to rank (1 is first), as
   * of the latest regular season week played. Followed for a league whose
   * format says so; null when Sleeper had none.
   */
  sleeperRanks?: Record<string, number> | null;
}

export interface Matchup {
  id: string;
  year: number;
  week: number;
  is_playoff: boolean;
  playoff_round: string | null;
  home_user_id: string;
  away_user_id: string;
  home_seed: number | null;
  away_seed: number | null;
  home_score: number;
  away_score: number;
}

/**
 * A matchup without its database-generated id.
 *
 * Both the row shape used for inserts and the input the standings and summary
 * logic needs — none of that logic looks at ids, so it can run on rows the
 * sync has just built but not yet read back.
 */
export type NewMatchup = Omit<Matchup, "id">;

export interface User {
  id: string;
  name: string;
  discord_id: string | null;
  onboarding_complete: boolean | null;
  email: string | null;
}

export type UserMap = Map<string, User>;

export interface CareerStatsRow {
  user_id: string;
  user_name: string;
  discord_id: string | null;
  seasons_played: number;
  regular_season_wins: number;
  regular_season_losses: number;
  regular_season_avg_points: number | null;
  regular_season_points_for: number | null;
  regular_season_points_against: number | null;
  highest_regular_season_score: number | null;
  weekly_high_scores: number;
  playoff_appearances: number;
  playoff_wins: number;
  playoff_losses: number;
  quarterfinal_appearances: number;
  semifinal_appearances: number;
  finals_appearances: number;
  first_place_finishes: number;
  second_place_finishes: number;
  third_place_finishes: number;
  playoff_points_for: number | null;
  playoff_points_against: number | null;
  playoff_avg_points: number | null;
}

export function matchupWinnerAndLoser(m: NewMatchup): { winner: string; loser: string } {
  if (m.home_score > m.away_score) {
    return { winner: m.home_user_id, loser: m.away_user_id };
  }
  if (m.away_score > m.home_score) {
    return { winner: m.away_user_id, loser: m.home_user_id };
  }
  return { winner: "", loser: "" };
}

/** Which owner held a Sleeper roster in a season. */
export interface Roster {
  league_id: string;
  roster_id: number;
  user_id: string;
}

/** A pick moved in a trade, named by the roster it was originally issued to. */
export interface TradedPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

export interface Transaction {
  id: string;
  league_id: string;
  year: number;
  week: number;
  type: string;
  status: string;
  roster_ids: number[];
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks: TradedPick[];
  waiver_budget: { sender: number; receiver: number; amount: number }[];
  created_at: string;
  completed_at: string | null;
}

/** An NFL player as last synced from Sleeper. */
export interface Player {
  id: string;
  name: string;
  position: string | null;
  /** Null for a free agent or retired player. */
  team: string | null;
  /**
   * Set when the player was named from a draft board because the full player
   * list was unavailable: his current team is then not known, rather than none.
   */
  teamUnknown?: boolean;
}

export interface DraftPick {
  draft_id: string;
  league_id: string;
  year: number;
  pick_no: number;
  round: number;
  draft_slot: number;
  /** The roster the pick was issued to; what a traded pick's roster_id names. */
  original_roster_id: number;
  /** The roster that made the pick. */
  roster_id: number;
  player_id: string;
  player_name: string;
  position: string;
  /** A player kept rather than drafted, in a keeper league. */
  is_keeper?: boolean;
}

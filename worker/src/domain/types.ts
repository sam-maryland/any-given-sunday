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
} as const;

export interface League {
  id: string;
  year: number;
  first_place: string;
  second_place: string;
  third_place: string;
  status: string;
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

export function matchupWinnerAndLoser(m: Matchup): { winner: string; loser: string } {
  if (m.home_score > m.away_score) {
    return { winner: m.home_user_id, loser: m.away_user_id };
  }
  if (m.away_score > m.home_score) {
    return { winner: m.away_user_id, loser: m.home_user_id };
  }
  return { winner: "", loser: "" };
}

import { describe, expect, it } from "vitest";
import { careerStatsToDiscordMessage } from "./careerStats";
import { CareerStatsRow } from "./types";

const row: CareerStatsRow = {
  user_id: "123",
  user_name: "Owner",
  discord_id: "d1",
  seasons_played: 2,
  regular_season_wins: 15,
  regular_season_losses: 9,
  regular_season_avg_points: 120,
  regular_season_points_for: 2880,
  regular_season_points_against: 2700,
  highest_regular_season_score: 180,
  weekly_high_scores: 2,
  playoff_appearances: 0,
  playoff_wins: 0,
  playoff_losses: 0,
  quarterfinal_appearances: 0,
  semifinal_appearances: 0,
  finals_appearances: 0,
  first_place_finishes: 0,
  second_place_finishes: 0,
  third_place_finishes: 0,
  playoff_points_for: 0,
  playoff_points_against: 0,
  playoff_avg_points: 0,
};

describe("careerStatsToDiscordMessage", () => {
  it("links to the owner's page on the site", () => {
    expect(careerStatsToDiscordMessage(row, "Owner")).toContain("<https://ags-hq.org/owner?id=123>");
  });
});

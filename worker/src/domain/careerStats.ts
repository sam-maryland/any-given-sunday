import { STANDINGS_URL } from "./standings";
import { CareerStatsRow } from "./types";

// The league's money, unchanged since it started in 2023. The website's
// owner pages (domain/history.ts) use the same figures.
export const PAY_IN_BUY_IN = 100;
export const PAY_OUT_WEEKLY_HIGH_SCORE = 15;
export const PAY_OUT_FIRST_PLACE = 600;
export const PAY_OUT_SECOND_PLACE = 300;
export const PAY_OUT_THIRD_PLACE = 120;

export function calculateCareerEarnings(c: CareerStatsRow): number {
  let earnings = 0;
  earnings -= c.seasons_played * PAY_IN_BUY_IN;
  earnings += c.weekly_high_scores * PAY_OUT_WEEKLY_HIGH_SCORE;
  earnings += c.first_place_finishes * PAY_OUT_FIRST_PLACE;
  earnings += c.second_place_finishes * PAY_OUT_SECOND_PLACE;
  earnings += c.third_place_finishes * PAY_OUT_THIRD_PLACE;
  return earnings;
}

export function careerStatsToDiscordMessage(c: CareerStatsRow, username: string): string {
  let b = "";

  b += `**${username}'s Career Stats** 📊\n\n`;

  if (c.first_place_finishes > 0 || c.second_place_finishes > 0 || c.third_place_finishes > 0) {
    b += "🏆 **Trophy Case:**\n";
    if (c.first_place_finishes > 0) {
      b += `   🏆 ${c.first_place_finishes}x Champion\n`;
    }
    if (c.second_place_finishes > 0) {
      b += `   🥈 ${c.second_place_finishes}x Runner-Up\n`;
    }
    if (c.third_place_finishes > 0) {
      b += `   🥉 ${c.third_place_finishes}x Third Place Finish\n`;
    }
    b += "\n";
  } else {
    b += "🏆 **Trophy Case:** 🕳️ A black hole of missed opportunities.\n\n";
  }

  const earnings = calculateCareerEarnings(c);
  if (earnings > 0) {
    b += `💵 **Career Earnings:** **$${earnings}** — ${username} is rollin’ in 💰\n\n`;
  } else if (earnings < 0) {
    b += `💵 **Career Earnings:** ❌ **-$${-earnings}** — ${username} is keeping the league solvent 🐖💥\n\n`;
  } else {
    b += `💵 **Career Earnings:** **$0** — ${username} has broken exactly even. Impressive... or lucky? 🤷‍♂️\n\n`;
  }

  b += `🏟️ **Regular Season:** ${c.regular_season_wins}-${c.regular_season_losses}\n`;
  b += `   ↳ Avg Points: ${(c.regular_season_avg_points ?? 0).toFixed(1)}\n`;
  b += `   ↳ Points For: ${(c.regular_season_points_for ?? 0).toFixed(1)}\n`;
  b += `   ↳ Points Against: ${(c.regular_season_points_against ?? 0).toFixed(1)}\n`;
  b += `   ↳ Weekly High Scores: ${c.weekly_high_scores}\n`;
  b += `   ↳ Highest Score: ${(c.highest_regular_season_score ?? 0).toFixed(1)}\n\n`;

  if (c.playoff_appearances === 0) {
    b += "🎯 **Playoffs:** 🫡 Hasn't made the playoffs... yet.\n\n";
  } else {
    b += `🎯 **Playoffs:** ${c.playoff_wins}-${c.playoff_losses} (${c.playoff_appearances} appearances)\n`;
    b += `   ↳ Quarterfinals: ${c.quarterfinal_appearances}\n`;
    b += `   ↳ Semifinals: ${c.semifinal_appearances}\n`;
    b += `   ↳ Finals: ${c.finals_appearances}\n`;
    b += `   ↳ Avg Points: ${(c.playoff_avg_points ?? 0).toFixed(1)}\n`;
    b += `   ↳ Points For: ${(c.playoff_points_for ?? 0).toFixed(1)}\n`;
    b += `   ↳ Points Against: ${(c.playoff_points_against ?? 0).toFixed(1)}\n\n`;
  }

  // The owner page has every season and every head-to-head record, which
  // don't fit here.
  b += `📜 Every season and rivalry: <${STANDINGS_URL}/owner?id=${encodeURIComponent(c.user_id)}>\n`;

  return b;
}

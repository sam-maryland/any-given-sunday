import { SupabaseClient } from "../data/supabase";
import { getNFLState } from "../data/sleeper";
import { standingsForLeague, Standing } from "./standings";
import { League, NewMatchup, UserMap } from "./types";

export interface WeeklyHighScore {
  userId: string;
  userName: string;
  score: number;
  week: number;
  year: number;
}

export interface WeeklySummary {
  leagueId: string;
  year: number;
  week: number;
  highScore: WeeklyHighScore | null;
  standings: Standing[];
  dataSyncStatus: string;
}

/**
 * Builds the weekly summary from data the caller already has.
 *
 * Pure and I/O-free so the scheduled recap can reuse the matchups and users it
 * fetched for the sync instead of re-querying them.
 *
 * @returns null when the season has no completed regular season weeks yet
 */
export function summaryFromMatchups(
  league: League,
  matchups: NewMatchup[],
  users: UserMap,
  dataSyncStatus = "",
): WeeklySummary | null {
  const regularSeason = matchups.filter((m) => !m.is_playoff);
  const latestWeek = regularSeason.reduce((max, m) => Math.max(max, m.week), 0);
  if (latestWeek === 0) {
    return null;
  }

  // Weekly high score: best single-team score of the latest completed week.
  let highScore: WeeklyHighScore | null = null;
  for (const m of regularSeason) {
    if (m.week !== latestWeek) continue;
    const [score, userId] =
      m.home_score > m.away_score
        ? [m.home_score, m.home_user_id]
        : [m.away_score, m.away_user_id];
    if (!highScore || score > highScore.score) {
      highScore = {
        userId,
        userName: users.get(userId)?.name ?? userId,
        score,
        week: latestWeek,
        year: league.year,
      };
    }
  }

  const { standings } = standingsForLeague(league, matchups);

  return {
    leagueId: league.id,
    year: league.year,
    week: latestWeek,
    highScore,
    standings,
    dataSyncStatus,
  };
}

// Loads the data it needs and builds the summary. Used by the /weekly-summary
// slash command; the scheduled recap uses summaryFromMatchups directly.
export async function generateWeeklySummary(
  db: SupabaseClient,
  year: number,
): Promise<WeeklySummary> {
  const league = await db.getLeagueByYear(year);
  if (!league) {
    throw new Error(`no league found for year ${year}`);
  }

  const matchups = await db.getMatchupsByYear(year);
  const users = await db.getUsers();

  const latestWeek = matchups
    .filter((m) => !m.is_playoff)
    .reduce((max, m) => Math.max(max, m.week), 0);

  const summary = summaryFromMatchups(
    league,
    matchups,
    users,
    await calculateDataSyncStatus(latestWeek),
  );
  if (!summary) {
    throw new Error(`no completed weeks found for year ${year}`);
  }
  return summary;
}

async function calculateDataSyncStatus(latestWeek: number): Promise<string> {
  try {
    const nflState = await getNFLState();
    if (latestWeek >= nflState.week) {
      return "✅ Current";
    }
    const weeksBehind = nflState.week - latestWeek;
    return weeksBehind === 1 ? "⏳ 1 week behind" : `⚠️ ${weeksBehind} weeks behind`;
  } catch {
    return "⚠️ Unable to verify sync status";
  }
}

export function formatWeeklySummary(summary: WeeklySummary, users: UserMap): string {
  let response = "";

  response += `📊 **Week ${summary.week} Summary (${summary.year})** 📊\n\n`;

  if (summary.highScore) {
    response += `🏆 **High Score Winner**: ${summary.highScore.userName} - ${summary.highScore.score.toFixed(2)} points\n`;
    response += "💰 Congrats! You've earned the $15 weekly high score bonus!\n\n";
  } else {
    response += "❌ No high score data available for this week\n\n";
  }

  response += "📈 **Current Standings:**\n";
  summary.standings.forEach((standing, i) => {
    const name = users.get(standing.userId)?.name ?? standing.userId;
    const medal = ["🥇", "🥈", "🥉"][i] ?? "";
    response += `${i + 1}. ${name} (${standing.wins}-${standing.losses})${medal ? ` ${medal}` : ""}\n`;
  });
  response += "\n";

  response += `Next update after Week ${summary.week + 1} games complete! 🏈`;

  return response;
}

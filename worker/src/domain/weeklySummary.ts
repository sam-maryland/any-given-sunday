import { SupabaseClient } from "../data/supabase";
import { getNFLState } from "../data/sleeper";
import { Standing, standingsForLeague } from "./standings";
import { UserMap } from "./types";

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

// Mirrors the Go GenerateWeeklySummary: reads existing DB data only (no
// Sleeper sync — the scheduled GitHub Actions job owns syncing).
export async function generateWeeklySummary(
  db: SupabaseClient,
  year: number,
): Promise<WeeklySummary> {
  const league = await requireLeagueByYear(db, year);

  const matchups = await db.getMatchupsByYear(year);

  const regularSeason = matchups.filter((m) => !m.is_playoff);
  const latestWeek = regularSeason.reduce((max, m) => Math.max(max, m.week), 0);
  if (latestWeek === 0) {
    throw new Error(`no completed weeks found for year ${year}`);
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
      highScore = { userId, userName: userId, score, week: latestWeek, year };
    }
  }
  if (highScore) {
    const user = await db.getUserById(highScore.userId);
    if (user) {
      highScore.userName = user.name;
    }
  }

  const { standings } = standingsForLeague(league, matchups);

  return {
    leagueId: league.id,
    year,
    week: latestWeek,
    highScore,
    standings,
    dataSyncStatus: await calculateDataSyncStatus(latestWeek),
  };
}

async function requireLeagueByYear(db: SupabaseClient, year: number) {
  const league = await db.getLeagueByYear(year);
  if (!league) {
    throw new Error(`no league found for year ${year}`);
  }
  return league;
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

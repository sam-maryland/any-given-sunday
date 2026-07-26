import { getNFLState, getUsersInLeague, teamName } from "../data/sleeper";
import { SupabaseClient } from "../data/supabase";
import { LeagueStatus, UserMap } from "../domain/types";
import { formatWeeklySummary, summaryFromMatchups } from "../domain/weeklySummary";
import { postToChannel } from "./channel";
import { sendWeeklyRecap } from "./email";
import { syncLatestData } from "./sync";

export interface RecapConfig {
  discordBotToken?: string;
  discordChannelId?: string;
  resendApiKey?: string;
  fromEmail?: string;
  /** When true, do everything except post to Discord and send email. */
  dryRun?: boolean;
}

export interface RecapOutcome {
  status: "completed" | "skipped";
  reason?: string;
  year?: number;
  week?: number;
  synced?: { weeksFetched: number[]; inserted: number; updated: number };
  discord?: "posted" | "skipped" | "failed" | "dry-run";
  email?: { status: "sent" | "skipped" | "failed" | "dry-run"; recipients?: number };
  message?: string;
}

/**
 * Runs the weekly recap: sync from Sleeper, build the summary, post it to
 * Discord, and email it out.
 *
 * Mirrors the Go RunWeeklyRecap: only IN_PROGRESS leagues are processed, and
 * notification failures are logged without failing the run (the data sync is
 * the part that must not be lost).
 */
export async function runWeeklyRecap(
  db: SupabaseClient,
  config: RecapConfig,
): Promise<RecapOutcome> {
  const league = await db.getLatestLeague();
  if (!league) {
    return { status: "skipped", reason: "no league found" };
  }

  if (league.status !== LeagueStatus.InProgress) {
    return {
      status: "skipped",
      reason: `league ${league.year} has status ${league.status} (not IN_PROGRESS)`,
      year: league.year,
    };
  }

  const nflState = await getNFLState();
  const existingMatchups = await db.getMatchupsByYear(league.year);

  const synced = await syncLatestData(
    db,
    league.id,
    league.year,
    nflState.week,
    existingMatchups,
  );

  // Re-read only when the sync actually changed something.
  const matchups =
    synced.inserted > 0 || synced.updated > 0
      ? await db.getMatchupsByYear(league.year)
      : existingMatchups;

  const users = await db.getUsers();
  const summary = summaryFromMatchups(league, matchups, users);
  if (!summary) {
    return {
      status: "skipped",
      reason: `no completed weeks found for year ${league.year}`,
      year: league.year,
      synced,
    };
  }

  const message = formatWeeklySummary(summary, users);
  const outcome: RecapOutcome = {
    status: "completed",
    year: summary.year,
    week: summary.week,
    synced,
    message,
  };

  outcome.discord = await postRecap(config, message);
  outcome.email = await emailRecap(db, config, league.id, summary, users);

  return outcome;
}

async function postRecap(
  config: RecapConfig,
  message: string,
): Promise<RecapOutcome["discord"]> {
  if (!config.discordBotToken || !config.discordChannelId) {
    console.log(JSON.stringify({ event: "recap_discord_skipped", reason: "not configured" }));
    return "skipped";
  }
  if (config.dryRun) {
    return "dry-run";
  }

  try {
    await postToChannel(config.discordBotToken, config.discordChannelId, message);
    return "posted";
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "recap_discord_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return "failed";
  }
}

async function emailRecap(
  db: SupabaseClient,
  config: RecapConfig,
  leagueId: string,
  summary: Parameters<typeof formatWeeklySummary>[0],
  users: UserMap,
): Promise<RecapOutcome["email"]> {
  if (!config.resendApiKey || !config.fromEmail) {
    console.log(JSON.stringify({ event: "recap_email_skipped", reason: "not configured" }));
    return { status: "skipped" };
  }

  try {
    const recipients = await db.getUsersWithEmail();
    if (recipients.length === 0) {
      return { status: "skipped", recipients: 0 };
    }

    // The email shows Sleeper team names rather than the DB's user names.
    const displayNames: UserMap = new Map(users);
    try {
      for (const sleeperUser of await getUsersInLeague(leagueId)) {
        const existing = displayNames.get(sleeperUser.user_id);
        displayNames.set(sleeperUser.user_id, {
          id: sleeperUser.user_id,
          name: teamName(sleeperUser),
          discord_id: existing?.discord_id ?? null,
          onboarding_complete: existing?.onboarding_complete ?? null,
          email: existing?.email ?? null,
        });
      }
    } catch (err) {
      // Fall back to DB names rather than dropping the email entirely.
      console.warn(
        JSON.stringify({
          event: "recap_team_names_unavailable",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    if (config.dryRun) {
      return { status: "dry-run", recipients: recipients.length };
    }

    const result = await sendWeeklyRecap(
      config.resendApiKey,
      config.fromEmail,
      summary,
      recipients,
      displayNames,
    );
    return { status: "sent", recipients: result.sent };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "recap_email_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "failed" };
  }
}

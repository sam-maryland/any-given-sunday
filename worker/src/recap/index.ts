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
  seasonType?: string;
  synced?: { weeksFetched: number[]; inserted: number; updated: number };
  /** Why nothing was sent this run, when the recap otherwise succeeded. */
  notificationsHeld?: string;
  discord?: "posted" | "skipped" | "failed" | "dry-run";
  email?: { status: "sent" | "skipped" | "failed" | "dry-run"; recipients?: number };
  message?: string;
}

// Sleeper's season_type values that mean games are being played. Outside
// these ("off" and "pre") there is nothing new to report.
const ACTIVE_SEASON_TYPES = new Set(["regular", "post"]);

/**
 * Runs the weekly recap: sync from Sleeper, build the summary, post it to
 * Discord, and email it out.
 *
 * Runs every week year-round. The first thing it does is read the league from
 * the database, which doubles as the keepalive that stops a free Supabase
 * project from pausing during the offseason.
 *
 * Notifications are held back unless there is genuinely something new: the
 * league must be IN_PROGRESS, the NFL season must be underway, and the sync
 * must have recorded new matchups. That makes the offseason quiet without
 * anyone having to disable the cron, and stops a re-run from sending the same
 * recap twice.
 *
 * As in the Go job, notification failures are logged without failing the run —
 * the data sync is the part that must not be lost.
 */
export async function runWeeklyRecap(
  db: SupabaseClient,
  config: RecapConfig,
): Promise<RecapOutcome> {
  // Also the Supabase keepalive — this read happens on every run, in season
  // or not, so the project never goes 7 days without activity.
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

  const users = await db.getUsers();
  const summary = summaryFromMatchups(league, synced.matchups, users);
  if (!summary) {
    return {
      status: "skipped",
      reason: `no completed weeks found for year ${league.year}`,
      year: league.year,
      synced: {
        weeksFetched: synced.weeksFetched,
        inserted: synced.inserted,
        updated: synced.updated,
      },
    };
  }

  const message = formatWeeklySummary(summary, users);
  const outcome: RecapOutcome = {
    status: "completed",
    year: summary.year,
    week: summary.week,
    seasonType: nflState.season_type,
    // Counts only — SyncResult also carries every matchup row, which has no
    // business in a log line.
    synced: {
      weeksFetched: synced.weeksFetched,
      inserted: synced.inserted,
      updated: synced.updated,
    },
    message,
  };

  const held = notificationsHeldReason(nflState.season_type, synced.inserted);
  if (held) {
    outcome.notificationsHeld = held;
    outcome.discord = "skipped";
    outcome.email = { status: "skipped" };
    return outcome;
  }

  outcome.discord = await postRecap(config, message);
  outcome.email = await emailRecap(config, league.id, summary, users);

  return outcome;
}

/**
 * Whether to stay quiet this run, and why.
 *
 * @returns the reason to hold notifications, or null to send them
 */
export function notificationsHeldReason(
  seasonType: string,
  insertedMatchups: number,
): string | null {
  if (!ACTIVE_SEASON_TYPES.has(seasonType)) {
    return `NFL season_type is "${seasonType}"`;
  }
  if (insertedMatchups === 0) {
    return "no new matchups were recorded this run";
  }
  return null;
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
    // Recipients come from the users we already loaded rather than a second
    // filtered query.
    const recipients = [...users.values()].filter((u) => !!u.email);
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

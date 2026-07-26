import { SupabaseClient } from "./data/supabase";
import { getRostersInLeague, getSleeperUser } from "./data/sleeper";
import { editOriginalResponse } from "./discord/api";
import {
  ApplicationCommandOptionType,
  ComponentType,
  Interaction,
  InteractionResponse,
  InteractionResponseType,
  MessageComponent,
  MessageFlags,
  SelectOption,
  interactionUser,
  jsonResponse,
} from "./discord/types";
import { standingsForLeague, standingsToDiscordMessage } from "./domain/standings";
import { LeagueStatus } from "./domain/types";
import { careerStatsToDiscordMessage } from "./domain/careerStats";
import { formatWeeklySummary, generateWeeklySummary } from "./domain/weeklySummary";

export const COMPONENT_ID_SLEEPER_USER_SELECT = "sleeper_user_select";

interface HandlerContext {
  db: SupabaseClient;
  appId: string;
  interaction: Interaction;
  ctx: ExecutionContext;
}

// Discord requires an acknowledgment within 3 seconds. Every handler defers
// immediately and finishes the real work in ctx.waitUntil, editing the
// deferred response when done.
function defer(
  hc: HandlerContext,
  work: () => Promise<{ content: string; components?: MessageComponent[] }>,
  options?: { ephemeral?: boolean },
): Response {
  const { appId, interaction } = hc;
  hc.ctx.waitUntil(
    (async () => {
      try {
        const result = await work();
        await editOriginalResponse(appId, interaction.token, {
          content: result.content,
          components: result.components,
        });
      } catch (err) {
        console.error(
          JSON.stringify({
            event: "interaction_error",
            command: interaction.data?.name ?? interaction.data?.custom_id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        await editOriginalResponse(appId, interaction.token, {
          content: "❌ Something went wrong handling that command.",
        }).catch(() => {});
      }
    })(),
  );

  const response: InteractionResponse = {
    type: InteractionResponseType.DeferredChannelMessageWithSource,
  };
  if (options?.ephemeral) {
    response.data = { flags: MessageFlags.Ephemeral };
  }
  return jsonResponse(response);
}

function numberOption(interaction: Interaction, name: string): number | undefined {
  const opt = interaction.data?.options?.find((o) => o.name === name);
  return typeof opt?.value === "number" ? opt.value : undefined;
}

export function handleStandingsCommand(hc: HandlerContext): Response {
  return defer(hc, async () => {
    const { db } = hc;
    const year = numberOption(hc.interaction, "year");

    const league = year ? await db.getLeagueByYear(year) : await db.getLatestLeague();
    if (!league) {
      return { content: "Hmm... I couldn't get the league." };
    }

    const matchups = await db.getMatchupsByYear(league.year);
    let content: string;
    try {
      const { standings, usedPlayoffResults } = standingsForLeague(league, matchups);
      const users = await db.getUsers();
      content = standingsToDiscordMessage(standings, league, users);
      if (league.status === LeagueStatus.Complete && !usedPlayoffResults) {
        content +=
          "\n_⚠️ Playoff results haven't been recorded for this season, so this is regular season order._";
      }
    } catch (err) {
      const playoffRounds: Record<string, number> = {};
      for (const m of matchups) {
        if (m.is_playoff) {
          const round = m.playoff_round ?? "null";
          playoffRounds[round] = (playoffRounds[round] ?? 0) + 1;
        }
      }
      console.error(
        JSON.stringify({
          event: "standings_error",
          leagueYear: league.year,
          leagueStatus: league.status,
          matchupCount: matchups.length,
          playoffRounds,
          isPlayoffType: typeof matchups[0]?.is_playoff,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return { content: "Hmm... I couldn't get the standings." };
    }
    return { content };
  });
}

export function handleCareerStatsCommand(hc: HandlerContext): Response {
  return defer(hc, async () => {
    const { db, interaction } = hc;
    const opt = interaction.data?.options?.find(
      (o) => o.type === ApplicationCommandOptionType.User,
    );
    const targetUserId = typeof opt?.value === "string" ? opt.value : undefined;
    if (!targetUserId) {
      return { content: "Hmm... I couldn't tell which user you meant." };
    }

    const resolved = interaction.data?.resolved;
    const targetUser = resolved?.users?.[targetUserId];
    const displayName =
      resolved?.members?.[targetUserId]?.nick ||
      targetUser?.global_name ||
      targetUser?.username ||
      targetUserId;

    const stats = await db.getCareerStatsByDiscordId(targetUserId);
    if (!stats) {
      return { content: `Hmm... I couldn't find any stats for ${displayName}.` };
    }

    return { content: careerStatsToDiscordMessage(stats, displayName) };
  });
}

export function handleWeeklySummaryCommand(hc: HandlerContext): Response {
  return defer(hc, async () => {
    const { db } = hc;
    let year = numberOption(hc.interaction, "year");

    if (!year) {
      const league = await db.getLatestLeague();
      if (!league) {
        return { content: "❌ Failed to get latest league" };
      }
      year = league.year;
    }

    const summary = await generateWeeklySummary(db, year);
    const users = await db.getUsers();
    return { content: formatWeeklySummary(summary, users) };
  });
}

export function handleOnboardCommand(hc: HandlerContext): Response {
  return defer(
    hc,
    async () => {
      const { db, interaction } = hc;
      const user = interactionUser(interaction);
      if (!user) {
        return { content: "❌ Couldn't tell who ran this command." };
      }

      if (await db.isUserOnboarded(user.id)) {
        return {
          content: "✅ You're already linked to a Sleeper account — all bot commands are available to you.",
        };
      }

      const options = await availableSleeperUserOptions(db);
      if (options.length === 0) {
        return {
          content:
            "**Welcome to the Any Given Sunday Discord!** 🏈\n\n" +
            "Unfortunately, all Sleeper accounts have already been claimed by other Discord users. " +
            "Please contact a league administrator if you believe this is an error or if you need " +
            "assistance linking your account manually.",
        };
      }

      return {
        content:
          "**Welcome to the Any Given Sunday Discord!** 🏈\n\n" +
          "To get started and use the bot commands, please select your Sleeper account from the " +
          "dropdown below. This links your Discord account to your fantasy team.\n\n" +
          "**Choose your Sleeper account:**",
        components: [
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.StringSelect,
                custom_id: COMPONENT_ID_SLEEPER_USER_SELECT,
                placeholder: "Select your Sleeper account...",
                min_values: 1,
                max_values: 1,
                options,
              },
            ],
          },
        ],
      };
    },
    { ephemeral: true },
  );
}

async function availableSleeperUserOptions(db: SupabaseClient): Promise<SelectOption[]> {
  const [unclaimed, league] = await Promise.all([
    db.getUsersWithoutDiscordId(),
    db.getLatestLeague(),
  ]);
  if (!league) {
    throw new Error("no league found");
  }

  const rosters = await getRostersInLeague(league.id);

  const options: SelectOption[] = [];
  for (const user of unclaimed) {
    let sleeperUser;
    try {
      sleeperUser = await getSleeperUser(user.id);
    } catch (err) {
      console.error(
        JSON.stringify({ event: "sleeper_user_fetch_failed", userId: user.id, error: String(err) }),
      );
      continue;
    }

    const roster = rosters.find(
      (r) => r.owner_id === user.id || (r.co_owners ?? []).includes(user.id),
    );

    let teamName = sleeperUser.metadata?.team_name ?? "";
    if (!teamName && roster) {
      teamName = `Team ${roster.roster_id}`;
    }

    let label = `${sleeperUser.display_name} (${sleeperUser.username})`;
    if (label.length > 80) {
      label = `${label.slice(0, 77)}...`;
    }

    let description = teamName ? `Team: ${teamName}` : undefined;
    if (description && description.length > 100) {
      description = `${description.slice(0, 97)}...`;
    }

    options.push({ label, value: user.id, description });
  }

  return options;
}

export function handleSleeperUserSelect(hc: HandlerContext): Response {
  const { db, appId, interaction } = hc;
  const selected = interaction.data?.values?.[0];
  const user = interactionUser(interaction);

  hc.ctx.waitUntil(
    (async () => {
      const fail = async (message: string) => {
        await editOriginalResponse(appId, interaction.token, {
          content: `❌ **Error:** ${message}`,
        });
      };

      try {
        if (!selected) {
          await fail("No Sleeper account selected. Please try again.");
          return;
        }
        if (!user) {
          await fail("Couldn't tell who made this selection.");
          return;
        }

        if (await db.isSleeperUserClaimed(selected)) {
          await fail("This Sleeper account has already been claimed by another Discord user.");
          return;
        }
        if (await db.isUserOnboarded(user.id)) {
          await fail("This Discord user is already linked to a Sleeper account.");
          return;
        }

        const linked = await db.linkDiscordToSleeperUser(selected, user.id);
        if (!linked) {
          await fail("This Sleeper account has already been claimed by another Discord user.");
          return;
        }

        await editOriginalResponse(appId, interaction.token, {
          content:
            "✅ **Successfully linked your Discord account!**\n\n" +
            `<@${user.id}>, you can now use all bot commands like \`/career-stats\` and ` +
            "`/standings`. Welcome to the league! 🏈",
          components: [],
        });
      } catch (err) {
        console.error(
          JSON.stringify({
            event: "onboarding_link_error",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        await fail("Something went wrong linking your account. Please try again.").catch(() => {});
      }
    })(),
  );

  // Acknowledge the component interaction; the waitUntil work edits the message.
  return jsonResponse({ type: InteractionResponseType.DeferredUpdateMessage });
}

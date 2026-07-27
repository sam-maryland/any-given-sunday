import { SupabaseClient } from "./data/supabase";
import { verifyDiscordSignature } from "./discord/verify";
import {
  Interaction,
  InteractionResponseType,
  InteractionType,
  jsonResponse,
} from "./discord/types";
import { RecapConfig, runWeeklyRecap } from "./recap";
import { recapEmailTime } from "./recap/schedule";
import {
  COMPONENT_ID_SLEEPER_USER_SELECT,
  handleCareerStatsCommand,
  handleOnboardCommand,
  handleSleeperUserSelect,
  handleStandingsCommand,
  handleWeeklySummaryCommand,
} from "./handlers";

function recapConfig(env: Env, scheduledTime: number): RecapConfig {
  return {
    discordBotToken: env.DISCORD_BOT_TOKEN,
    discordChannelId: env.DISCORD_WEEKLY_RECAP_CHANNEL_ID,
    resendApiKey: env.RESEND_API_KEY,
    fromEmail: env.FROM_EMAIL,
    emailScheduledAt: recapEmailTime(scheduledTime),
    // Set in .dev.vars so local `wrangler dev --test-scheduled` runs exercise
    // the full path without posting to Discord or emailing the league.
    dryRun: env.RECAP_DRY_RUN === "true",
  };
}

export default {
  // Weekly recap (cron). Syncs Sleeper data, posts to Discord, sends email.
  async scheduled(controller, env, ctx): Promise<void> {
    const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    ctx.waitUntil(
      (async () => {
        try {
          // The recap text is the whole Discord post; keep it out of the log
          // except on dry runs, where seeing it is the point.
          const { message, ...summary } = await runWeeklyRecap(
            db,
            recapConfig(env, controller.scheduledTime),
          );
          console.log(
            JSON.stringify({
              event: "weekly_recap",
              cron: controller.cron,
              ...summary,
              ...(env.RECAP_DRY_RUN === "true" ? { message } : {}),
            }),
          );
        } catch (err) {
          console.error(
            JSON.stringify({
              event: "weekly_recap_failed",
              cron: controller.cron,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
          throw err;
        }
      })(),
    );
  },

  async fetch(request, env, ctx): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("any-given-sunday discord bot", { status: 200 });
    }

    const signature = request.headers.get("X-Signature-Ed25519");
    const timestamp = request.headers.get("X-Signature-Timestamp");
    if (!signature || !timestamp) {
      return new Response("missing signature headers", { status: 401 });
    }

    const body = await request.text();
    const valid = await verifyDiscordSignature(
      env.DISCORD_PUBLIC_KEY,
      signature,
      timestamp,
      body,
    );
    if (!valid) {
      return new Response("invalid request signature", { status: 401 });
    }

    const interaction = JSON.parse(body) as Interaction;

    if (interaction.type === InteractionType.Ping) {
      return jsonResponse({ type: InteractionResponseType.Pong });
    }

    const hc = {
      db: new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY),
      appId: env.DISCORD_APP_ID,
      interaction,
      ctx,
    };

    if (interaction.type === InteractionType.ApplicationCommand) {
      console.log(JSON.stringify({ event: "command", name: interaction.data?.name }));
      switch (interaction.data?.name) {
        case "standings":
          return handleStandingsCommand(hc);
        case "career-stats":
          return handleCareerStatsCommand(hc);
        case "weekly-summary":
          return handleWeeklySummaryCommand(hc);
        case "onboard":
          return handleOnboardCommand(hc);
        default:
          return jsonResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: { content: `Unknown command: ${interaction.data?.name ?? "?"}` },
          });
      }
    }

    if (interaction.type === InteractionType.MessageComponent) {
      console.log(JSON.stringify({ event: "component", customId: interaction.data?.custom_id }));
      if (interaction.data?.custom_id === COMPONENT_ID_SLEEPER_USER_SELECT) {
        return handleSleeperUserSelect(hc);
      }
      return jsonResponse({ type: InteractionResponseType.DeferredUpdateMessage });
    }

    return new Response("unsupported interaction type", { status: 400 });
  },
} satisfies ExportedHandler<Env>;

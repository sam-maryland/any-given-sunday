import { SupabaseClient } from "./data/supabase";
import { verifyDiscordSignature } from "./discord/verify";
import {
  Interaction,
  InteractionResponseType,
  InteractionType,
  jsonResponse,
} from "./discord/types";
import {
  COMPONENT_ID_SLEEPER_USER_SELECT,
  handleCareerStatsCommand,
  handleOnboardCommand,
  handleSleeperUserSelect,
  handleStandingsCommand,
  handleWeeklySummaryCommand,
} from "./handlers";

export default {
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

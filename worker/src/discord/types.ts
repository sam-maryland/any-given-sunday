// Minimal Discord interaction types — only the fields this bot reads.
// https://discord.com/developers/docs/interactions/receiving-and-responding

export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
} as const;

export const InteractionResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
  DeferredChannelMessageWithSource: 5,
  DeferredUpdateMessage: 6,
  UpdateMessage: 7,
} as const;

export const MessageFlags = {
  Ephemeral: 1 << 6,
} as const;

export const ComponentType = {
  ActionRow: 1,
  StringSelect: 3,
} as const;

export const ApplicationCommandOptionType = {
  String: 3,
  Integer: 4,
  User: 6,
  Number: 10,
} as const;

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface GuildMember {
  nick?: string | null;
  user?: DiscordUser;
}

export interface CommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
}

export interface InteractionData {
  // Application command fields
  name?: string;
  options?: CommandOption[];
  resolved?: {
    users?: Record<string, DiscordUser>;
    members?: Record<string, GuildMember>;
  };
  // Message component fields
  custom_id?: string;
  component_type?: number;
  values?: string[];
}

export interface Interaction {
  id: string;
  type: number;
  token: string;
  application_id: string;
  guild_id?: string;
  channel_id?: string;
  member?: GuildMember;
  user?: DiscordUser;
  data?: InteractionData;
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

export interface MessageComponent {
  type: number;
  components?: MessageComponent[];
  custom_id?: string;
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  options?: SelectOption[];
}

export interface InteractionResponseData {
  content?: string;
  flags?: number;
  components?: MessageComponent[];
}

export interface InteractionResponse {
  type: number;
  data?: InteractionResponseData;
}

export function jsonResponse(body: InteractionResponse): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

// The user who triggered the interaction (member in guilds, user in DMs).
export function interactionUser(interaction: Interaction): DiscordUser | undefined {
  return interaction.member?.user ?? interaction.user;
}

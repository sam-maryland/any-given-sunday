// Registers the bot's guild slash commands with Discord.
// Run once after deploying (and again whenever command definitions change):
//   npm run register-commands
// Requires DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID (see .dev.vars.example).

const OPTION_TYPE_USER = 6;
const OPTION_TYPE_NUMBER = 10;

const commands = [
  {
    name: "career-stats",
    description: "Get career stats for a specific user",
    options: [
      {
        type: OPTION_TYPE_USER,
        name: "user",
        description: "The user to get stats for",
        required: true,
      },
    ],
  },
  {
    name: "standings",
    description: "Get the standings for a specific year",
    options: [
      {
        type: OPTION_TYPE_NUMBER,
        name: "year",
        description: "The year to get standings for",
        required: false,
      },
    ],
  },
  {
    name: "weekly-summary",
    description: "Generate weekly summary with high score winner and updated standings",
    options: [
      {
        type: OPTION_TYPE_NUMBER,
        name: "year",
        description: "The year to generate summary for",
        required: false,
      },
    ],
  },
  {
    name: "onboard",
    description: "Link your Discord account to your Sleeper fantasy team",
  },
];

const { DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_APP_ID || !DISCORD_GUILD_ID) {
  console.error("DISCORD_TOKEN, DISCORD_APP_ID, and DISCORD_GUILD_ID must be set");
  process.exit(1);
}

const res = await fetch(
  `https://discord.com/api/v10/applications/${DISCORD_APP_ID}/guilds/${DISCORD_GUILD_ID}/commands`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bot ${DISCORD_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  },
);

if (!res.ok) {
  console.error(`Failed to register commands (${res.status}): ${await res.text()}`);
  process.exit(1);
}

const registered = await res.json();
console.log(`Registered ${registered.length} commands: ${registered.map((c) => c.name).join(", ")}`);

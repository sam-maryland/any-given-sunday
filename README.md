# Any Given Sunday

A Discord bot for fantasy football league management with automated weekly recaps and comprehensive statistics tracking. Built specifically for [Sleeper](https://sleeper.app) fantasy football leagues.

## Features

- **Discord Commands**: Interactive slash commands for league management
  - `/weekly-summary` - Get weekly matchup results and standings
  - `/standings` - View current league standings
  - `/career-stats` - Historical performance statistics
  - `/onboard` - Link new league members to their Sleeper team
- **Automated Weekly Recaps**: A Cloudflare Worker cron trigger posts weekly summaries every Tuesday
- **Standings Dashboard**: A web page showing the current standings, served from the same Worker
- **League Data Sync**: Real-time integration with Sleeper API for up-to-date information
- **Historical Statistics**: Track career performance across multiple seasons
- **Easy Deployment**: Designed for technical commissioners to set up for their own leagues

Everything runs as a single [Cloudflare Worker](worker/): the slash commands
are served from Discord's HTTP interactions endpoint, the weekly recap runs on
a cron trigger, and the dashboard is served as static assets — all from the
same Worker. Data lives in Supabase.

## Prerequisites

- **Sleeper Fantasy Football League** - Must have an active Sleeper league
- **Discord Server** - Server where the bot will operate with appropriate permissions
- **PostgreSQL Database** - Supabase is used in this project ([create account](https://supabase.com))
- **Cloudflare account** - The Worker runs on the free plan
- **Node.js 22+** - For local development
- **Go 1.23+ and Mage** - Only for the database schema tooling (`mage db:*`)

## Quick Start

### 1. Development Setup

```bash
cd worker
npm install
```

### 2. Discord Bot Setup

1. Create a Discord application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a bot user and copy the bot token
3. Generate an invite link with these permissions:
   - Send Messages
   - Use Slash Commands
   - Mention Everyone
   - Create Public Threads
   - Use External Emojis
4. Add the bot to your Discord server using the invite link

### 3. Database Setup

This project uses Supabase as the PostgreSQL provider:

1. Create a [Supabase project](https://supabase.com)
2. Copy your database URL from Project Settings → Database
3. Set up your environment variables (see Configuration section)
4. Check your database status and apply schema:
   ```bash
   mage db:status
   mage db:sync
   ```

### 4. Configuration

The Worker's settings are stored as Cloudflare secrets, not a `.env` file —
see [the setup guide](docs/deployment/cloudflare-workers-setup.md) for the
full list and where each value comes from. For local development, copy
`worker/.dev.vars.example` to `worker/.dev.vars` and fill it in.

The schema tooling (`mage db:*`) is the one thing that still reads a
root-level `.env`, for `DATABASE_URL`.

### 5. Local Development

```bash
cd worker
npm run dev      # slash commands, on http://localhost:8787
npm test         # unit tests
npm run check    # type check
```

### 6. Deployment

```bash
cd worker
npm ci
npm run deploy
```

Pushes to `main` that touch `worker/` deploy automatically via GitHub
Actions. Full details in
[docs/deployment/cloudflare-workers-setup.md](docs/deployment/cloudflare-workers-setup.md).

The weekly recap runs as a cron trigger in the same Worker, delivering the
email at 8am Eastern every Tuesday.

## Configuration

### Worker secrets

Set with `wrangler secret put <NAME>` from `worker/`:

| Secret | Used by | Description |
|--------|---------|-------------|
| `DISCORD_PUBLIC_KEY` | slash commands | Verifies Discord's request signatures |
| `DISCORD_APP_ID` | slash commands | Discord application ID |
| `SUPABASE_URL` | both | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | both | Service role key (server-side only) |
| `DISCORD_TOKEN` | weekly recap | Bot token, to post the recap message |
| `DISCORD_WEEKLY_RECAP_CHANNEL_ID` | weekly recap | Channel for automated weekly posts |
| `RESEND_API_KEY` | weekly recap | Resend API key for recap emails |
| `FROM_EMAIL` | weekly recap | Sender address for recap emails |

The recap's Discord post and email are independently optional — if their
secrets are unset, that step is skipped and the data sync still runs.

`DATABASE_URL` is read from a root `.env` by the `mage db:*` schema tooling
only; the Worker never uses it.

### Finding Your Sleeper League ID

1. Navigate to your league on Sleeper web app
2. The league ID is in the URL: `https://sleeper.app/leagues/LEAGUE_ID/team`
3. Copy the numeric ID from the URL

## Usage

### Discord Commands

- **`/weekly-summary [week]`** - Get matchup results and standings for specified week (defaults to current week)
- **`/standings`** - Display current league standings with win-loss records
- **`/career-stats [user]`** - Show historical statistics for a user across seasons
- **`/onboard`** - Link your Discord account to your Sleeper team (new members run this themselves)

### Automated Features

The Worker runs a cron trigger that automatically:
- Runs every Tuesday at 8am Eastern
- Syncs the latest matchup data from Sleeper
- Updates the database with completed games
- Posts a formatted weekly recap to your designated Discord channel

This automation ensures your league stays up-to-date without manual intervention after Monday Night Football concludes.

### Standings Dashboard

The Worker's own URL serves a standings page in the browser, backed by
`GET /api/standings` (add `?year=YYYY` for a past season). Both read the same
tables and run the same `standingsForLeague()` logic as `/standings` in
Discord, so the two can never disagree on the order.

Teams are labelled with their Sleeper team name rather than the owner's name,
the same way the recap email is. If Sleeper is unreachable the page falls back
to the names stored in the database. Note that `/standings` in Discord still
shows owner names.

Because matchups only reach the database when the weekly recap cron syncs
them, the dashboard is as fresh as the last sync — it changes on Tuesdays, not
during Sunday's games.

That also makes the standings cacheable on a known boundary. Responses are
held in Cloudflare's cache under a key that includes the most recent cron run
(`lastSyncBoundary()`), so a cache hit costs no Supabase or Sleeper requests at
all, and the next sync changes the key — which invalidates every colo at once
without anything having to send a purge. The `X-Cache` response header reports
`HIT` or `MISS`.

Entries also expire after an hour regardless, so an out-of-band database edit
(playoff results tagged by hand, say) shows up without waiting for Tuesday.

The cache is per-colo, not global: a viewer routed to a data center that has
not served the page yet still pays for one load. Note that this only works
because the Worker has a custom domain — Cache API operations have no effect
on `workers.dev`.

### Hosting

The dashboard is served from `ags-hq.org`, configured as a Custom Domain route
in `wrangler.jsonc`; Cloudflare manages the DNS record and certificate. The
`workers.dev` subdomain is disabled (`"workers_dev": false`) — `ags-hq.org` is
the Worker's only hostname.

The root path is shared: Discord POSTs its interactions to `https://ags-hq.org/`,
and every non-POST request is served the dashboard.

Note for anyone adding a route later: when `routes` is set and `workers_dev` is
not, a deploy tears down the `*.workers.dev` route. That is how the Interactions
Endpoint URL went dead once — Discord was still pointed at the subdomain. Keep
the endpoint on a domain the config names outright.

## Development

### Project Structure

```
├── worker/                 # Everything the bot does (TypeScript)
│   ├── src/index.ts        # Routing: interactions, /api, assets, recap cron
│   ├── src/handlers.ts     # Slash command handlers
│   ├── src/api/            # JSON endpoints for the dashboard
│   ├── src/discord/        # Signature verification, interaction types
│   ├── src/domain/         # Standings, career stats, weekly summary
│   ├── src/data/           # Supabase (REST) and Sleeper API clients
│   ├── src/recap/          # Sleeper sync, Discord post, Resend email
│   ├── public/             # Dashboard, served as Workers static assets
│   └── scripts/            # Slash command registration
├── pkg/db/schema.sql       # Canonical database schema
├── tools/dbsync/           # Schema sync tooling (Go)
└── magefile.go             # Schema tooling entry points
```

### Worker Development

```bash
cd worker
npm test         # unit tests
npm run check    # type check
npm run dev      # local server
```

### Available Mage Commands

Mage now only covers database schema management. Everything else lives in
`worker/` and uses npm.

#### Database Management
- `mage db:status` - Show sync status between local and remote schema
- `mage db:diff` - Display detailed schema differences
- `mage db:sync` - Apply local schema changes to Supabase
- `mage db:rollback` - Roll back the last migration
- `mage db:migrations` - List all applied migrations
- `mage db:verify` - Check that the local schema matches Supabase

### Running Tests

```bash
cd worker && npm test
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with appropriate tests
4. Ensure all tests pass with `cd worker && npm test`
5. Submit a pull request

## API Integration

This project integrates with the [Sleeper API](https://docs.sleeper.app/) to fetch league data, matchups, and user information. The API client handles rate limiting and error recovery automatically.

## Troubleshooting

### Common Issues

**Bot not responding to commands**
- Verify bot has correct permissions in Discord server
- Check that bot token is valid and properly set
- Ensure bot is online (check Discord server member list)

**Database connection errors**
- Verify DATABASE_URL is correct and accessible
- Check database sync status with `mage db:status`
- Run `mage db:sync` to apply schema changes
- Ensure Supabase project is active and not paused

**Missing weekly data**
- Confirm SLEEPER_LEAGUE_ID matches your actual league
- Verify the league week has completed (all games finished)
- Check that league is active for the current season

**GitHub Actions not running**
- Ensure repository secrets are properly configured
- Check that the workflow file is in `.github/workflows/`
- Verify cron schedule is correct for your timezone

**Build issues**
- Run `mage clean` to remove old build artifacts
- Ensure Go 1.23+ is installed
- Install Mage with `mage install` if not present

## License

This project is open source and available under the MIT License.

## Support

For issues and feature requests, please use the GitHub issue tracker. For questions about Sleeper API integration, refer to their [official documentation](https://docs.sleeper.app/).
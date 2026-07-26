# Any Given Sunday

A Discord bot for fantasy football league management with automated weekly recaps and comprehensive statistics tracking. Built specifically for [Sleeper](https://sleeper.app) fantasy football leagues.

## Features

- **Discord Commands**: Interactive slash commands for league management
  - `/weekly-summary` - Get weekly matchup results and standings
  - `/standings` - View current league standings
  - `/career-stats` - Historical performance statistics
  - `/onboard` - Link new league members to their Sleeper team
- **Automated Weekly Recaps**: GitHub Actions automation posts weekly summaries every Tuesday
- **League Data Sync**: Real-time integration with Sleeper API for up-to-date information
- **Historical Statistics**: Track career performance across multiple seasons
- **Easy Deployment**: Designed for technical commissioners to set up for their own leagues

## Prerequisites

- **Sleeper Fantasy Football League** - Must have an active Sleeper league
- **Discord Server** - Server where the bot will operate with appropriate permissions
- **PostgreSQL Database** - Supabase is used in this project ([create account](https://supabase.com))
- **Go 1.23+** - For local development and building
- **Mage** - Build tool used for this project

## Quick Start

### 1. Development Setup

```bash
# Install Mage build tool
mage install

# Install dependencies
go mod download
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

### 4. Environment Configuration

Create a `.env` file with the following variables:

```env
DATABASE_URL=your_supabase_connection_string
DISCORD_TOKEN=your_discord_bot_token
DISCORD_WEEKLY_RECAP_CHANNEL_ID=channel_id_for_automated_recaps
RESEND_API_KEY=your_resend_api_key
FROM_EMAIL=recaps@yourdomain.com
```

### 5. Local Development

```bash
# Build and run the weekly recap job
mage run

# Or build the binary separately
mage build
```

For the Discord bot itself (slash commands), see
[docs/deployment/cloudflare-workers-setup.md](docs/deployment/cloudflare-workers-setup.md).

### 6. Deployment

The interactive bot is a Cloudflare Worker serving Discord's HTTP
interactions endpoint — see
[docs/deployment/cloudflare-workers-setup.md](docs/deployment/cloudflare-workers-setup.md).

```bash
cd worker
npm ci
npm run deploy
```

The scheduled weekly recap still runs the Go binary via GitHub Actions
(`.github/workflows/weekly-recap.yml`).

## Configuration

### Required Environment Variables

The weekly recap job (Go) reads these:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `DISCORD_TOKEN` | Discord bot token (for posting the recap) |
| `DISCORD_WEEKLY_RECAP_CHANNEL_ID` | Channel for automated weekly posts |
| `RESEND_API_KEY` | Resend API key for recap emails |
| `FROM_EMAIL` | Sender address for recap emails |

Discord and email are both optional — if their variables are unset, the
job syncs data and skips those notifications.

The Worker's secrets are configured separately with `wrangler secret put`;
see the [Workers setup guide](docs/deployment/cloudflare-workers-setup.md).

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

The bot includes a GitHub Actions workflow that automatically:
- Runs every Tuesday at 4 AM ET
- Syncs the latest matchup data from Sleeper
- Updates the database with completed games
- Posts a formatted weekly recap to your designated Discord channel

This automation ensures your league stays up-to-date without manual intervention after Monday Night Football concludes.

## Development

### Project Structure

The interactive bot (slash commands) and the scheduled weekly recap are
two separate programs in two languages:

```
├── worker/              # Cloudflare Worker: Discord slash commands (TypeScript)
│   ├── src/discord/     # Signature verification, interaction types
│   ├── src/domain/      # Standings, career stats, weekly summary formatting
│   └── src/data/        # Supabase (REST) and Sleeper API clients
├── cmd/weekly-recap/    # Scheduled Tuesday recap job (Go)
├── internal/
│   ├── app/             # Weekly recap orchestration
│   ├── interactor/      # Sleeper sync + summary business logic
│   ├── discord/         # Channel poster for the recap message
│   └── email/           # Resend email delivery
├── pkg/
│   ├── client/sleeper/  # Sleeper API integration
│   ├── db/              # Database operations (sqlc)
│   └── types/           # Domain types and DB converters
├── migrations/          # Database schema migrations
└── magefile.go          # Build automation
```

### Available Mage Commands

#### Core Development
- `mage test` - Run all tests
- `mage build` - Build the weekly-recap binary
- `mage run` - Build and run the weekly recap locally
- `mage clean` - Remove build artifacts

Worker development lives in `worker/` and uses npm — see the
[Workers setup guide](docs/deployment/cloudflare-workers-setup.md).

#### Database Management
- `mage db:status` - Show sync status between local and remote schema
- `mage db:diff` - Display detailed schema differences
- `mage db:sync` - Apply local schema changes to Supabase
- `mage db:rollback` - Roll back the last migration
- `mage db:migrations` - List all applied migrations
- `mage db:verify` - Check schema sync and SQLC integration

### Running Tests

```bash
# Run all tests
mage test
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with appropriate tests
4. Ensure all tests pass with `mage test`
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
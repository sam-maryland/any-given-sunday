# Any Given Sunday

A Discord bot for fantasy football league management with automated weekly recaps and comprehensive statistics tracking. Built specifically for [Sleeper](https://sleeper.app) fantasy football leagues.

## Features

- **Discord Commands**: Interactive slash commands for league management
  - `/weekly-summary` - Get weekly matchup results and standings
  - `/standings` - View current league standings
  - `/career-stats` - Historical performance statistics
  - `/onboarding` - Set up new league members
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
DISCORD_GUILD_ID=your_discord_server_id
DISCORD_WEEKLY_RECAP_CHANNEL_ID=channel_id_for_automated_recaps
SLEEPER_LEAGUE_ID=your_sleeper_league_id
```

### 5. Local Development

```bash
# Build and run the bot locally
mage run

# Or build binaries separately
mage build
```

### 6. Deployment

The project is configured for Google Cloud Run deployment:

```bash
# Build Docker image
mage docker:build

# Test Docker container locally
mage docker:run
```

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `DISCORD_TOKEN` | Discord bot token |
| `DISCORD_GUILD_ID` | Discord server ID |
| `DISCORD_WEEKLY_RECAP_CHANNEL_ID` | Channel for automated weekly posts |
| `SLEEPER_LEAGUE_ID` | Your Sleeper league ID |

### Finding Your Sleeper League ID

1. Navigate to your league on Sleeper web app
2. The league ID is in the URL: `https://sleeper.app/leagues/LEAGUE_ID/team`
3. Copy the numeric ID from the URL

## Usage

### Discord Commands

- **`/weekly-summary [week]`** - Get matchup results and standings for specified week (defaults to current week)
- **`/standings`** - Display current league standings with win-loss records
- **`/career-stats [user]`** - Show historical statistics for a user across seasons
- **`/onboarding`** - Set up new league members and sync their data

### Automated Features

The bot includes a GitHub Actions workflow that automatically:
- Runs every Tuesday at 4 AM ET
- Syncs the latest matchup data from Sleeper
- Updates the database with completed games
- Posts a formatted weekly recap to your designated Discord channel

This automation ensures your league stays up-to-date without manual intervention after Monday Night Football concludes.

## Development

### Project Structure

```
├── cmd/
│   ├── commish-bot/     # Main Discord bot application
│   └── weekly-recap/    # CLI tool for automated recaps
├── internal/
│   ├── discord/         # Discord command handlers
│   ├── interactor/      # Business logic layer
│   └── app/            # Application orchestration
├── pkg/
│   ├── client/sleeper/  # Sleeper API integration
│   ├── db/             # Database operations
│   └── config/         # Configuration management
├── migrations/         # Database schema migrations
└── magefile.go         # Build automation
```

### Available Mage Commands

#### Core Development
- `mage test` - Run all tests
- `mage build` - Build all binaries
- `mage run` - Build and run the bot locally
- `mage clean` - Remove build artifacts

#### Docker Operations
- `mage docker:build` - Build Docker image
- `mage docker:run` - Run Docker container locally
- `mage docker:test` - Test Docker build and startup
- `mage docker:clean` - Remove Docker artifacts

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
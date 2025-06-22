# AI Agent Session Context

## Quick Project Overview
**Project**: Any Given Sunday Discord Bot - Fantasy football league management bot
**Tech Stack**: Go + discordgo + PostgreSQL + SQLC + Mage build system
**Architecture**: Clean architecture with Discord handlers → Interactor (business logic) → Database

## Current State
### Existing Commands
- `/career-stats @user` - Shows career statistics
- `/standings [year]` - League standings with custom tiebreakers  
- `/weekly-summary [year]` - Weekly high scores and updated standings

### Project Structure
```
internal/discord/          # Discord command handlers
internal/interactor/       # Business logic layer
internal/dependency/       # Dependency injection + mocks
pkg/db/                   # SQLC generated database code
pkg/client/sleeper/       # Sleeper API client
pkg/types/domain/         # Domain models
```

## Development Patterns
### Adding New Commands
1. Create handler in `internal/discord/[command].go`
2. Add business logic in `internal/interactor/[domain].go`
3. Register command in `internal/discord/handler.go`
4. Add tests following table-driven test pattern
5. Use `mage test` and `mage build` for validation

### Code Style
- Clean architecture with dependency injection
- Comprehensive testing with mocks
- SQLC for type-safe database operations
- Standard Go conventions with golangci-lint

## Key Files for Context
- `internal/discord/handler.go` - Command registration and routing
- `internal/interactor/interactor.go` - Business logic interfaces
- `internal/dependency/dependency.go` - DI container
- `pkg/types/domain/` - Core domain types

## Build Commands
- `mage build` - Build the bot
- `mage run` - Run locally
- `mage test` - Run all tests
- `sqlc generate` - Regenerate DB code

## Current Priorities
See `docs/features/backlog.md` for prioritized feature list.

## Authentication & APIs
- Discord bot uses standard Discord OAuth
- Sleeper API requires no authentication
- PostgreSQL database with connection pooling
- Environment variables for secrets
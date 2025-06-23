# Feature: Weekly Recap and Data Sync

*Quick tip: Save this as `docs/features/in-progress/[feature-name].md` when you start working on it*

## Status
- [x] **Planning** - Initial design and requirements gathering
- [x] **Ready for Development** - Requirements complete, ready to code
- [ ] **In Progress** - Currently being implemented
- [ ] **Testing** - Implementation complete, testing in progress
- [ ] **Complete** - Feature shipped and working in production

**Last Updated**: 2025-06-22
**Estimated Effort**: Medium (7-10 hours)
**Priority**: High

---

## Overview

### Problem Statement
*What problem does this feature solve? What user pain point are we addressing?*

This project currently has the capability to get a weekly summary "on-demand", but there is currently no way to automatically get the results from the previous week's games and update the DB accordingly. This means that a manual process will need to happen to update the matchups data in the DB, which then informs the career stats view.

### Solution Summary
*Brief description of the proposed solution*

Create a job that will run in Github Actions that will retrieve the finalized matchup data from Sleeper, update the DB with the matchup data from the previous week, and send a message to the Discord general channel which provides a recap for the week. This logic currently lives in the `/weekly-job` command that a Discord user can send, but it should also happen automatically on a weekly basis.

### User Story

As a **fantasy football league member**, I want to get an automated recap of the results from last week's fantasy matchups.

As a **fantasy football commissioner**, I don't want to have to manually update data in the database from the previous week's matchups.

### Success Criteria
*How will we know this feature is successful?*
- [ ] **Automated execution**: Weekly recap runs automatically every Tuesday without manual intervention
- [ ] **Data accuracy**: Matchup data is successfully synced from Sleeper API and stored in database
- [ ] **Discord delivery**: Weekly summary is posted to Discord general channel with proper formatting
- [ ] **Reliability**: Job succeeds consistently (>95% success rate) with proper error handling
- [ ] **Scheduled Delivery**: Recap is posted at 7:30am on Tuesday morning following Monday Night Football completion
- [ ] **User satisfaction**: League members stop asking for manual weekly updates

---

## Requirements

### Functional Requirements
*What the feature must do*
- [ ] **Automated Scheduling**: Run weekly job every Tuesday at 4 AM ET via GitHub Actions
- [ ] **Data Synchronization**: Fetch latest matchup data from Sleeper API for completed weeks
- [ ] **Database Updates**: Insert new matchups in PostgreSQL database
- [ ] **Weekly Summary Generation**: Generate formatted weekly recap using existing business logic
- [ ] **Discord Posting**: Post weekly summary directly to Discord "weekly recap" channel
- [ ] **Error Recovery**: Handle API failures, database connectivity issues, and Discord posting errors
- [ ] **Manual Trigger**: Allow manual execution of weekly job when needed
- [ ] **Completion Detection**: Only sync data for weeks that have finished (all games completed)

### Non-Functional Requirements
*Performance, security, usability requirements*
- [ ] **Performance**: Complete execution within 5 minutes including all API calls and database operations
- [ ] **Security**: Securely handle Discord bot token and database credentials via GitHub Actions secrets
- [ ] **Reliability**: Implement retry logic for transient failures (3 retries with exponential backoff)
- [ ] **Monitoring**: Log execution results and errors for debugging and monitoring
- [ ] **Idempotency**: Safe to run multiple times - won't create duplicate data or messages
- [ ] **Scalability**: Support current league size and structure without hardcoded limits

### Out of Scope
*What this feature explicitly will NOT do*
- **Real-time updates**: Not live scoring during games, only final results after completion
- **Interactive features**: No user reactions, voting, or dynamic Discord interactions in automated posts
- **Multiple leagues**: Initially focused on single league, multi-league support can be added later
- **Custom scheduling**: Fixed Tuesday schedule initially, customizable timing is future enhancement
- **Advanced analytics**: Basic summary only, detailed statistical analysis is separate feature
- **Payment automation**: Will mention high score winner but won't handle actual payment processing

---

## GitHub Actions Workflow Specification

### Workflow Trigger
```yaml
name: Weekly Fantasy Recap
on:
  schedule:
    - cron: '0 9 * * 2'  # Tuesday at 4 AM ET (14:00 UTC)
  workflow_dispatch:      # Allow manual triggering
```

### Environment Variables Required
- `DATABASE_URL` - PostgreSQL connection string for Supabase
- `DISCORD_TOKEN` - Bot token for Discord API access
- `DISCORD_GUILD_ID` - Guild ID for the fantasy league Discord server
- `DISCORD_WEEKLY_RECAP_CHANNEL_ID` - Channel ID where weekly recap should be posted

### Execution Steps
1. **Setup Go Environment** (Go 1.21+)
2. **Install Dependencies** (`go mod download`)
3. **Build Application** (`go build -o weekly-recap ./cmd/weekly-recap`)
4. **Execute Weekly Job** (`./weekly-recap --mode=weekly-recap`)
5. **Report Status** (success/failure notification)

### Expected Discord Output Format
*What gets posted to the Discord channel*

```
📊 **Week 12 Summary (2024)** 📊

🏆 **High Score Winner**: John's Team - 156.84 points
💰 Congrats! You've earned the $15 weekly high score bonus!

📈 **Current Standings:**
1. Team Alpha (9-3) 🥇
2. Team Beta (8-4) 🥈  
3. Team Gamma (7-5) 🥉
4. Team Delta (6-6)
5. Team Echo (5-7)
...

📊 **This Week's Results:**
• Team Alpha 142.3 def. Team Echo 118.7
• Team Beta 134.1 def. Team Delta 129.8
• John's Team 156.8 def. Team Gamma 145.2

Next update after Week 13 games complete! 🏈
```

### Error Handling & Recovery
*What happens when things go wrong*
- **Sleeper API unavailable** → Retry 3 times with exponential backoff, notify admin channel on failure
- **Database connection failure** → Log error, send admin notification with connection details
- **Discord posting failure** → Retry posting, fallback to admin DM if channel posting fails
- **Partial data sync** → Continue with available data, log missing information for manual review
- **No completed games** → Skip execution, log that no new data was available

---

## Technical Implementation

### Architecture Decision
*How does this fit into existing code structure?*

**Pattern**: Reuse existing business logic with new CLI execution mode
**Files to Create/Modify**:
- `cmd/weekly-recap/main.go` - New CLI entrypoint for automation
- `.github/workflows/weekly-recap.yml` - GitHub Actions workflow definition
- `internal/app/weekly_recap.go` - Orchestration logic for automated execution
- `internal/discord/channel_poster.go` - Direct channel posting (vs command response)
- Environment variable configuration for Discord channel targeting

### Database Changes
*Any database schema or query changes needed?*

**Required**: None - reuses existing database schema and operations
- Uses existing `matchups`, `users`, `leagues` tables
- Leverages existing `InsertMatchup()` and `UpdateMatchupScores()` operations
- Utilizes existing `GetLatestCompletedWeek()` and `GetWeeklyHighScore()` queries

**Optional**: Add execution tracking table for monitoring
- Track successful runs, errors, and execution timestamps
- Monitor data sync performance and reliability metrics

### External Dependencies
*New APIs, libraries, or services needed*

**Existing Dependencies** (no changes needed):
- Sleeper API client (`pkg/client/sleeper`) - already integrated with rate limiting
- Discord API via `github.com/bwmarrin/discordgo` - already configured
- PostgreSQL via Supabase - existing connection and query infrastructure

**New Dependencies**:
- GitHub Actions environment - workflow execution, secrets management
- Cron scheduling - built into GitHub Actions, no additional service needed

**Considerations**:
- GitHub Actions free tier limitations (2000 minutes/month, sufficient for weekly execution)
- Sleeper API rate limiting (already handled with exponential backoff)
- Discord API rate limiting (minimal impact for single weekly message)
- The Action should be able to determine the League ID by getting the current active league.
- If there is no active league, the job should exit gracefully without attempting to fetch or update data. It also should not send a message to Discord.

### Code Structure Overview
```go
// Main CLI entry point (cmd/weekly-recap/main.go)
func main() {
    ctx := context.Background()
    
    // Initialize dependencies (database, Discord client, Sleeper client)
    app := initializeApp()
    
    // Execute weekly recap workflow
    if err := app.RunWeeklyRecap(ctx); err != nil {
        log.Fatal("Weekly recap failed:", err)
    }
}

// Weekly recap orchestration (internal/app/weekly_recap.go)
func (a *App) RunWeeklyRecap(ctx context.Context) error {
    // 1. Sync latest data from Sleeper API (reuse existing logic)
    if err := a.weeklyJobInteractor.SyncLatestData(ctx, currentYear); err != nil {
        return fmt.Errorf("failed to sync data: %w", err)
    }
    
    // 2. Generate weekly summary (reuse existing logic)
    summary, err := a.weeklyJobInteractor.GenerateWeeklySummary(ctx, currentYear)
    if err != nil {
        return fmt.Errorf("failed to generate summary: %w", err)
    }
    
    // 3. Post to Discord channel (new implementation)
    return a.channelPoster.PostWeeklySummary(ctx, summary)
}

// Channel posting (internal/discord/channel_poster.go)
func (p *ChannelPoster) PostWeeklySummary(ctx context.Context, summary string) error {
    // Direct channel message (not command response)
    _, err := p.session.ChannelMessageSend(p.channelID, summary)
    return err
}

// Reuse existing types and business logic from:
// - internal/interactor/weekly_job.go (WeeklyJobInteractor)
// - pkg/client/sleeper/ (Sleeper API integration)
// - pkg/db/ (Database operations)
```

---

## Testing Strategy

### Unit Tests
*What units of code need testing?*
- [ ] Handler parameter extraction and validation
- [ ] Interactor business logic with various inputs
- [ ] Error handling for all failure scenarios
- [ ] Discord response formatting

### Integration Tests
*End-to-end testing scenarios*
- [ ] Full command flow with valid week number
- [ ] Invalid input handling
- [ ] Sleeper API integration
- [ ] Database integration (if applicable)

### Manual Testing Checklist
*Test cases to verify manually*
- [ ] Command works in Discord development server
- [ ] Response formatting looks good on mobile
- [ ] Error messages are user-friendly
- [ ] Performance is acceptable (< 2 seconds)

---

## Implementation Plan

### Phase 1: CLI Application & GitHub Actions (3-4 hours)
- [ ] Create `cmd/weekly-recap/main.go` CLI entrypoint
- [ ] Implement `internal/app/weekly_recap.go` orchestration layer
- [ ] Create `.github/workflows/weekly-recap.yml` workflow file
- [ ] Add environment variable configuration for Discord channel targeting
- [ ] Basic error handling and logging

### Phase 2: Discord Channel Posting (2-3 hours)
- [ ] Implement `internal/discord/channel_poster.go` for direct channel messaging
- [ ] Add retry logic for Discord API failures
- [ ] Test Discord message formatting and delivery
- [ ] Handle edge cases (channel not found, permissions, etc.)
- [ ] Integrate with existing summary generation logic

### Phase 3: Testing & Monitoring (2-3 hours)
- [ ] Create test environment for GitHub Actions workflow
- [ ] Test manual workflow dispatch functionality
- [ ] Add comprehensive error logging and status reporting
- [ ] Verify idempotency (safe to run multiple times)
- [ ] Documentation and deployment verification

### Estimated Timeline
- **Phase 1**: 3-4 hours (CLI setup and GitHub Actions)
- **Phase 2**: 2-3 hours (Discord integration and testing)
- **Phase 3**: 2-3 hours (testing, monitoring, documentation)
- **Total**: 7-10 hours

---

## Future Enhancements
*Ideas for extending this feature later*

- **Enhanced Summary Content**: Individual matchup results, biggest upsets, closest games
- **Multiple Scheduling Options**: Configurable timing (Monday evening, Wednesday morning, etc.)
- **Multi-League Support**: Handle multiple fantasy leagues with separate Discord channels
- **Interactive Elements**: Reaction-based voting for "Game of the Week" or "Performance of the Week"
- **Payment Integration**: Automated payment reminders and tracking for high score bonuses
- **Advanced Analytics**: Week-over-week trend analysis, record-breaking performances
- **Custom Notifications**: League-specific messaging preferences and content customization
- **Integration with Other Commands**: Link to detailed stats, standings, or prediction features

---

## Notes & Decisions

### Design Decisions
*Important decisions made during development*

**Decision**: Use existing Discord command pattern
**Reasoning**: Consistency with other commands, proven approach

**Decision**: Default to current week
**Reasoning**: Most common use case, reduces typing

### Technical Notes
*Implementation details for future reference*

- Sleeper API returns matchups as individual team entries, need to group by matchup_id
- Handle bye weeks (some teams may not have matchups)
- Consider caching for performance if API calls become expensive

### AI Agent Context
*Quick context for AI development sessions*

**Goal**: Create automated weekly fantasy football recap that runs via GitHub Actions and posts to Discord
**Existing Foundation**: Leverage existing weekly job logic in `internal/interactor/weekly_job.go` and `/weekly-summary` command
**Key Files**: 
- `internal/interactor/weekly_job.go` - Core business logic (reuse as-is)
- `internal/discord/weekly_summary.go` - Existing Discord command pattern for reference
- `pkg/client/sleeper/` - Sleeper API integration (already implemented)
**Pattern**: Create new CLI mode that reuses existing business logic with direct Discord channel posting
**Priority**: High value, low risk implementation by reusing proven components

---

## Completion Checklist

### Development Complete
- [ ] Core functionality implemented
- [ ] All error cases handled
- [ ] Code follows project conventions
- [ ] No TODO comments or debug code left

### Testing Complete  
- [ ] Unit tests written and passing
- [ ] Integration tests passing
- [ ] Manual testing completed
- [ ] Edge cases verified

### Documentation Complete
- [ ] Code comments added
- [ ] README updated if needed
- [ ] This feature doc updated with final implementation notes
- [ ] Moved to `docs/features/completed/` directory

### Ready for Production
- [ ] Code reviewed
- [ ] Performance tested
- [ ] Deployed to staging environment
- [ ] User acceptance testing passed

**Completion Date**: [Date]
**Final Notes**: [Any important notes for future reference]
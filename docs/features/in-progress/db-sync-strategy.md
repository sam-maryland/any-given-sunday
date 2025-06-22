# Feature: DB Sync Strategy

## Status
- [x] **Planning** - Initial design and requirements gathering
- [x] **Ready for Development** - Requirements complete, ready to code
- [ ] **In Progress** - Currently being implemented
- [ ] **Testing** - Implementation complete, testing in progress
- [ ] **Complete** - Feature shipped and working in production

**Last Updated**: 2025-06-22
**Estimated Effort**: Medium (14-20 hours)
**Priority**: High

---

## Overview

### Problem Statement
*What problem does this feature solve? What user pain point are we addressing?*

Currently, there is no formal database schema versioning or migration system in place. Developers face several critical issues:

1. **No clear schema change process**: When adding features requiring DB changes, developers don't know whether to modify Supabase directly or update schema.sql locally first
2. **Schema drift between environments**: The local schema.sql file is out of sync with the Supabase database (missing indexes, views, constraint differences)
3. **Manual error-prone process**: Schema changes require manual copying between schema.sql and Supabase console, leading to mistakes and inconsistencies
4. **No rollback capability**: Cannot easily undo schema changes if issues arise
5. **Poor team collaboration**: Multiple developers making schema changes creates conflicts and overwrites
6. **No audit trail**: No way to track who made what schema changes when

### Solution Summary
*Brief description of the proposed solution*

Implement a comprehensive database schema management system that:
1. **Establishes schema.sql as single source of truth** - All schema changes start here
2. **Adds formal migration system** - Version-controlled migrations with up/down capability
3. **Integrates Supabase CLI** - Automated deployment of schema changes to Supabase
4. **Creates sync verification** - Tools to detect and resolve schema drift
5. **Adds developer tooling** - Mage commands for common schema operations
6. **Enables safe rollbacks** - Ability to undo problematic schema changes

### User Story
As a **developer**, I want **a reliable database schema management system** so that **I can safely make schema changes without breaking production or causing conflicts with other developers**.

As a **team lead**, I want **automated schema deployment and verification** so that **database changes are consistent, auditable, and can be rolled back if needed**.

### Success Criteria
*How will we know this feature is successful?*
- [ ] Schema changes can be applied consistently
- [ ] Zero manual schema changes needed in Supabase console
- [ ] All existing schema drift resolved (indexes, views, constraints)
- [ ] Developers can safely rollback problematic schema changes
- [ ] Full audit trail of all database schema modifications
- [ ] New features with DB changes can be implemented in under 30 minutes
- [ ] No more "schema.sql is out of sync" issues

---

## Requirements

### Functional Requirements
*What the feature must do*
- [ ] **Schema Sync Detection**: Automatically detect differences between local schema.sql and Supabase database
- [ ] **Migration Generation**: Generate migration files from schema.sql changes
- [ ] **Safe Application**: Apply migrations to Supabase with rollback capability
- [ ] **Drift Resolution**: Resolve existing schema inconsistencies (missing indexes, views, constraints)
- [ ] **Verification**: Confirm schema changes were applied correctly
- [ ] **Developer Commands**: Provide mage commands for common operations (sync, diff, rollback)
- [ ] **SQLC Integration**: Regenerate Go code after successful schema changes
- [ ] **Status Reporting**: Show current sync status and any pending changes

### Non-Functional Requirements
*Performance, security, usability requirements*
- [ ] **Safety**: All operations must be reversible and non-destructive
- [ ] **Performance**: Schema operations complete within 30 seconds
- [ ] **Reliability**: Handle network failures and partial deployments gracefully
- [ ] **Usability**: Clear error messages and confirmation prompts for destructive operations
- [ ] **Security**: Never expose database credentials in logs or output
- [ ] **Compatibility**: Work with existing SQLC workflow and pgx driver

### Out of Scope
*What this feature explicitly will NOT do*
- **Data migrations**: Only handles schema changes, not data transformations
- **Multi-database support**: Focused only on PostgreSQL/Supabase
- **GUI tools**: Command-line interface only
- **Real-time sync**: Manual trigger-based, not continuous monitoring
- **Backup management**: Separate concern from schema versioning
- **Environment management**: Single target database (Supabase production)

---

## CLI Command Specification

### Command Syntax
```bash
mage db:command [options]
```

### Available Commands
- `mage db:status` - Show current sync status between schema.sql and Supabase
- `mage db:diff` - Display detailed differences between local and remote schema  
- `mage db:sync` - Apply schema.sql changes to Supabase (with confirmation)
- `mage db:rollback [version]` - Rollback to previous schema version
- `mage db:verify` - Verify schema integrity and SQLC compatibility

### Usage Examples
```bash
# Check current sync status
mage db:status

# See what changes would be applied
mage db:diff

# Apply pending schema changes
mage db:sync

# Rollback last migration
mage db:rollback

# Verify everything is working
mage db:verify
```

### Expected Output Format
*Mock up what the command responses should look like*

```bash
$ mage db:status
📊 Database Schema Status

Local Schema:  pkg/db/schema.sql (modified 2 hours ago)
Remote Schema: Supabase Production

Status: 🔴 OUT OF SYNC
Pending Changes: 3

🔍 Missing in Supabase:
  - INDEX idx_users_discord_id ON users(discord_id)  
  - VIEW career_stats (161 lines)
  - ALTER TABLE leagues.status SET NOT NULL DEFAULT ''

Run 'mage db:diff' for detailed comparison
Run 'mage db:sync' to apply changes
```

### Error Handling
*What happens when things go wrong*
- No database connection → "Cannot connect to Supabase. Check DATABASE_URL"
- Schema parse error → "Invalid SQL in schema.sql at line X"
- Unsafe operation → "Cannot proceed: would drop data. Use --force flag"
- Network timeout → "Supabase connection timeout. Retry in a few minutes"

---

## Technical Implementation

### Architecture Decision
*How does this fit into existing code structure?*

**Pattern**: Add database management utilities to existing Mage build system
**Files to Create/Modify**:
- `tools/dbsync/` - New package for database synchronization logic
- `tools/dbsync/schema.go` - Schema parsing and comparison utilities
- `tools/dbsync/migrate.go` - Migration generation and application
- `tools/dbsync/supabase.go` - Supabase-specific integration
- `magefile.go` - Add DB namespace with sync commands
- `migrations/` - Directory for versioned migration files (new)
- Tests for all new database sync functionality

### Database Changes
*Any database schema or query changes needed?*

**Required**: Add migration tracking table to Supabase
```sql
CREATE TABLE schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT NOW(),
    checksum VARCHAR(64) NOT NULL
);
```

**Future**: All schema changes will go through this system

### External Dependencies
*New APIs, libraries, or services needed*

**New Dependencies**:
- `github.com/lib/pq` - PostgreSQL driver for schema introspection
- `github.com/golang-migrate/migrate/v4` - Migration management (optional)
- SQL parser library (evaluate options: `github.com/xwb1989/sqlparser` or similar)

**Existing**: 
- `github.com/jackc/pgx/v5` - Current database driver (continue using)
- Supabase PostgreSQL instance (no changes needed)

**Considerations**: 
- Keep dependencies minimal to avoid conflicts
- Ensure compatibility with existing pgx connection pool

### Code Structure Overview
```go
// Mage commands (magefile.go)
type DB mg.Namespace

func (DB) Status() error {
    return dbsync.ShowStatus()
}

func (DB) Diff() error {
    return dbsync.ShowDifferences()
}

func (DB) Sync() error {
    return dbsync.ApplyChanges()
}

// Core sync logic (tools/dbsync/schema.go)
type SchemaComparison struct {
    LocalSchema  *Schema
    RemoteSchema *Schema
    Differences  []SchemaDiff
}

func CompareSchemas(local, remote string) (*SchemaComparison, error) {
    // Parse both schemas
    // Compare tables, indexes, views, constraints
    // Return structured differences
}

// Migration management (tools/dbsync/migrate.go)
type Migration struct {
    Version   string
    UpSQL     string
    DownSQL   string
    Checksum  string
}

func GenerateMigration(diff *SchemaDiff) (*Migration, error) {
    // Convert schema differences to SQL migration
    // Generate both up and down migrations
    // Calculate checksum for integrity
}
```

---

## Implementation Plan

### Phase 1: Foundation & Schema Parsing
- [ ] Create `tools/dbsync` package structure
- [ ] Implement schema.sql parser
- [ ] Add Supabase schema introspection
- [ ] Create basic schema comparison logic
- [ ] Add initial mage commands (`mage db:status`, `mage db:diff`)

### Phase 2: Migration System
- [ ] Design migration file format and versioning
- [ ] Implement migration generation from schema diffs
- [ ] Add migration tracking table to Supabase
- [ ] Create migration application logic with rollback
- [ ] Add `mage db:sync` and `mage db:rollback` commands

### Phase 3: Resolve Existing Drift & Polish
- [ ] Apply current schema inconsistencies as first migration
- [ ] Add comprehensive error handling and confirmations
- [ ] Integrate with SQLC workflow (`mage db:verify`)
- [ ] Add safety checks and validation
- [ ] Performance optimization and testing

### Estimated Timeline
- **Phase 1**: 4-6 hours (schema parsing, basic comparison)
- **Phase 2**: 6-8 hours (migration system, database integration)
- **Phase 3**: 4-6 hours (polish, safety, integration)
- **Total**: 14-20 hours

---

## Future Enhancements
*Ideas for extending this feature later*

- **Supabase CLI integration**: Use `supabase db diff` and `supabase db push` where possible
- **Automatic SQLC regeneration**: Trigger `sqlc generate` after successful schema changes
- **Schema validation**: Ensure all SQLC queries still work after schema changes
- **Data migration support**: Handle data transformations alongside schema changes
- **CI/CD integration**: Automated schema deployment in GitHub Actions
- **Schema documentation**: Auto-generate docs from schema changes
- **Conflict resolution**: Handle concurrent schema changes from multiple developers

---

## Notes & Decisions

### AI Agent Context
*Quick context for AI development sessions*

**Goal**: Create database schema management system with automated sync between schema.sql and Supabase
**Pattern**: Add `tools/dbsync` package with Mage commands for schema operations
**Current Issue**: Schema drift exists - missing indexes, views, and column constraints in Supabase
**Key Files**: 
- `pkg/db/schema.sql` - Local schema (source of truth)
- `magefile.go` - Add DB namespace for new commands
- `tools/dbsync/` - New package for sync logic
**Testing**: Focus on schema parsing, comparison accuracy, and safe migration application
**Priority**: Resolve existing drift first, then implement ongoing sync system

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
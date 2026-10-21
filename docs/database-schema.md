# Database Schema Documentation

## Overview

This document outlines the database structure for the Any Given Sunday fantasy football league application. The database tracks users, matchups and league information, plus each season's rosters, transactions and draft from Sleeper.

## Tables

### users
Stores information about fantasy football league participants.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | text | PRIMARY KEY | Sleeper User ID |
| name | text | NOT NULL | Display name of the user |
| discord_id | text | NOT NULL, DEFAULT '' | Discord user ID for integration |
| onboarding_complete | boolean | DEFAULT false | Whether user completed Discord onboarding |
| created_at | timestamptz | DEFAULT now() | Account creation timestamp |

**Indexes:**
- `idx_users_discord_id` on discord_id (defined in schema.sql, missing in Supabase)

### matchups
Stores individual game matchup data for regular season and playoff games.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique matchup identifier |
| year | integer | NOT NULL | Season year (e.g., 2023, 2024) |
| week | integer | NOT NULL | Week number |
| is_playoff | boolean | DEFAULT false | Whether matchup is playoff game |
| playoff_round | text | NULL | Playoff round name (quarterfinal, semifinal, final, third_place) |
| home_user_id | text | NOT NULL, REFERENCES users(id) | Home team user |
| away_user_id | text | NOT NULL, REFERENCES users(id) | Away team user |
| home_seed | integer | NULL | Playoff seed for home team |
| away_seed | integer | NULL | Playoff seed for away team |
| home_score | double precision | NOT NULL | Home team final score |
| away_score | double precision | NOT NULL | Away team final score |

**Row Level Security:** Enabled in Supabase

### leagues
Stores league-level information and final standings.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | text | PRIMARY KEY | Sleeper League ID |
| year | integer | NOT NULL | League season year |
| first_place | text | DEFAULT '', NOT NULL | User ID of champion |
| second_place | text | DEFAULT '', NOT NULL | User ID of runner-up |
| third_place | text | DEFAULT '', NOT NULL | User ID of third place |
| status | text | DEFAULT '', NOT NULL* | League status (IN_PROGRESS, COMPLETE, PENDING) |

*Note: In Supabase, status column is nullable with no default value

### rosters
Which owner held each Sleeper roster in a season. Sleeper's transactions and draft picks name rosters, not users.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| league_id | text | NOT NULL, REFERENCES leagues(id) | Sleeper League ID |
| roster_id | integer | NOT NULL | Sleeper roster ID within that league |
| user_id | text | NOT NULL, REFERENCES users(id) | Owner of the roster that season |

**Indexes:** `idx_rosters_league_roster` unique on (league_id, roster_id)

### transactions
Every Sleeper transaction: trades, waiver claims (including failed ones), free agent pickups and commissioner moves. Offseason moves belong to the league they were made in, filed under week 1. Synced by the weekly recap; `npm run backfill-activity` fills in earlier seasons.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | text | PRIMARY KEY | Sleeper transaction ID |
| league_id | text | NOT NULL, REFERENCES leagues(id) | League the transaction was made in |
| year | integer | NOT NULL | Season of that league |
| week | integer | NOT NULL | Sleeper's leg |
| type | text | NOT NULL | trade, waiver, free_agent or commissioner |
| status | text | NOT NULL | complete or failed |
| roster_ids | integer[] | NOT NULL | Rosters involved |
| adds | jsonb | NULL | Player ID → roster that received them |
| drops | jsonb | NULL | Player ID → roster that gave them up |
| draft_picks | jsonb | NOT NULL, DEFAULT '[]' | Picks moved: season, round, roster_id (the roster the pick was issued to), previous_owner_id, owner_id — all roster IDs |
| waiver_budget | jsonb | NOT NULL, DEFAULT '[]' | FAAB moved: sender, receiver, amount |
| created_at | timestamptz | NOT NULL | When the transaction was proposed |
| completed_at | timestamptz | NULL | When it was processed |

**Indexes:** `idx_transactions_year_week` on (year, week); `idx_transactions_adds` GIN on adds, for finding every move involving a player

### draft_picks
Every pick in each league's draft: the 2023 startup draft, then the yearly rookie drafts. Stored once Sleeper marks the draft complete.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| draft_id | text | NOT NULL | Sleeper draft ID |
| league_id | text | NOT NULL, REFERENCES leagues(id) | League the draft belongs to |
| year | integer | NOT NULL | Season of that league |
| pick_no | integer | NOT NULL | Overall pick number |
| round | integer | NOT NULL | Round |
| draft_slot | integer | NOT NULL | Column of the draft board |
| original_roster_id | integer | NOT NULL | Roster the pick was issued to (from the draft's slot_to_roster_id); matches a traded pick's roster_id |
| roster_id | integer | NOT NULL | Roster that made the pick |
| player_id | text | NOT NULL | Sleeper player ID |
| player_name | text | NOT NULL | Name as Sleeper had it at the draft |
| position | text | NOT NULL | Position as Sleeper had it at the draft |

**Indexes:** `idx_draft_picks_draft_pick` unique on (draft_id, pick_no); `idx_draft_picks_player` on player_id

### players
Every NFL player who has been through the league: drafted, traded, claimed or dropped. Transactions and draft picks name players by Sleeper id only. Written weekly by the sync-players GitHub Action (`npm run sync-players`), which reads Sleeper's full player list — too big for the Worker on the free plan. Photos are not stored: Sleeper serves them at `https://sleepercdn.com/content/nfl/players/thumb/{id}.jpg` (a few players have none), and defenses use `https://sleepercdn.com/images/team_logos/nfl/{id lowercased}.png`.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | text | PRIMARY KEY | Sleeper player ID; a team abbreviation for a defense |
| name | text | NOT NULL | Current name |
| position | text | NULL | Current position |
| team | text | NULL | Current NFL team; null for a free agent or retired player |
| updated_at | timestamptz | NOT NULL, DEFAULT now() | When the sync last wrote the row |

## Views

### career_stats
A comprehensive view that calculates career statistics for all users across multiple seasons.

**Key Metrics:**
- Regular season record (wins/losses)
- Regular season scoring statistics
- Playoff appearances and performance
- Championship finishes (1st, 2nd, 3rd place)
- Weekly high score achievements

*Note: This view is defined in schema.sql but missing from Supabase*

## Relationships

- `matchups.home_user_id` → `users.id`
- `matchups.away_user_id` → `users.id`

## Schema Discrepancies

### Missing in Supabase:
1. **Index:** `idx_users_discord_id` on users table
2. **View:** `career_stats` view for comprehensive statistics
3. **Column constraint:** `leagues.status` has different nullability and default value

### Data Types:
- schema.sql uses `FLOAT` for scores, Supabase shows `double precision` (equivalent)
- schema.sql uses `TIMESTAMPTZ`, Supabase shows `timestamp with time zone` (equivalent)

## Security

- **Row Level Security (RLS)** is enabled on:
  - `matchups` table
  - `users` table
- `leagues` table does not have RLS enabled

## Usage Patterns

The database supports:
- Multi-season league tracking
- Regular season and playoff game recording
- User management with Discord integration
- Comprehensive career statistics calculation
- League championship tracking

## Recommendations

1. Apply missing index `idx_users_discord_id` to Supabase for efficient Discord lookups
2. Create the `career_stats` view in Supabase for statistics queries
3. Standardize the `leagues.status` column constraints between schema.sql and Supabase
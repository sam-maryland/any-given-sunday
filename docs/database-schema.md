# Database Schema Documentation

## Overview

This document outlines the database structure for the Any Given Sunday fantasy football league application. The database consists of three main tables that track users, matchups, and league information.

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
CREATE TABLE IF NOT EXISTS users (
                                     id TEXT PRIMARY KEY,                       -- Sleeper User ID (this can be your user ID in Sleeper)
                                     name TEXT NOT NULL,                        -- Name of the user
                                     discord_id TEXT DEFAULT '' NOT NULL,       -- Discord user ID
                                     onboarding_complete BOOLEAN DEFAULT FALSE, -- Whether user has completed Discord onboarding
                                     email TEXT DEFAULT '' NOT NULL,            -- User email address for weekly recap notifications
                                     created_at TIMESTAMPTZ DEFAULT NOW()       -- Timestamp when the user joined
);

-- Create index for efficient Discord ID lookups
CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id);

-- Create index for efficient email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS matchups (
                                        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,         -- Unique ID for each matchup
                                        year INTEGER NOT NULL,                                  -- Year of the matchup (e.g., 2023 or 2024)
                                        week INTEGER NOT NULL,                                  -- Week of the matchup (e.g., 17 for finals)
                                        is_playoff BOOLEAN DEFAULT FALSE,                       -- Whether the matchup is during playoffs
                                        playoff_round TEXT,                                     -- NULL unless is_playoff is true
                                        home_user_id TEXT NOT NULL REFERENCES users(id),        -- User ID for the home team
                                        away_user_id TEXT NOT NULL REFERENCES users(id),        -- User ID for the away team
                                        home_seed INTEGER,                                      -- Playoff seed for home team
                                        away_seed INTEGER,                                      -- Playoff seed for away team
                                        home_score FLOAT NOT NULL,                              -- Total score for the home team
                                        away_score FLOAT NOT NULL                               -- Total score for the away team
);

create table if not exists leagues (
                                       id text primary key,                                          -- Sleeper League ID
                                       year integer not null,                                        -- Year that league started (e.g., 2023 or 2024)
                                       first_place text default '' not null,    -- User ID for the first place team
                                       second_place text default '' not null,   -- User ID for the second place team
                                       third_place text default '' not null,    -- User ID for the third place team
                                       status text default '' not null          -- Status of the league (e.g., 'IN_PROGRESS', 'COMPLETE', 'PENDING')
);

-- Which owner held each Sleeper roster in a season. Sleeper's transactions
-- and draft picks name rosters, not users, and a roster can change hands
-- between seasons, so the mapping is kept per league rather than read live.
create table if not exists rosters (
                                       league_id text not null references leagues(id), -- Sleeper League ID
                                       roster_id integer not null,                     -- Sleeper roster ID within that league
                                       user_id text not null references users(id)      -- Owner of the roster that season
);

create unique index if not exists idx_rosters_league_roster on rosters(league_id, roster_id);

-- Every Sleeper transaction: trades, waiver claims (including failed ones),
-- free agent pickups and commissioner moves. Offseason moves belong to the
-- league they were made in, which Sleeper files under week 1.
create table if not exists transactions (
                                            id text primary key,                            -- Sleeper transaction ID
                                            league_id text not null references leagues(id), -- League the transaction was made in
                                            year integer not null,                          -- Season of that league
                                            week integer not null,                          -- Sleeper's leg
                                            type text not null,                             -- 'trade', 'waiver', 'free_agent' or 'commissioner'
                                            status text not null,                           -- 'complete' or 'failed'
                                            roster_ids integer[] not null,                  -- Rosters involved
                                            adds jsonb,                                     -- Player ID -> roster that received them
                                            drops jsonb,                                    -- Player ID -> roster that gave them up
                                            draft_picks jsonb default '[]' not null,        -- Picks moved: season, round, roster_id (original), previous_owner_id, owner_id
                                            waiver_budget jsonb default '[]' not null,      -- FAAB moved: sender, receiver, amount
                                            created_at timestamptz not null,                -- When the transaction was proposed
                                            completed_at timestamptz                        -- When it was processed
);

create index if not exists idx_transactions_year_week on transactions(year, week);
create index if not exists idx_transactions_adds on transactions using gin (adds);

-- Every pick made in a league's draft: the 2023 startup draft, then the
-- yearly rookie drafts.
create table if not exists draft_picks (
                                           draft_id text not null,                         -- Sleeper draft ID
                                           league_id text not null references leagues(id), -- League the draft belongs to
                                           year integer not null,                          -- Season of that league
                                           pick_no integer not null,                       -- Overall pick number
                                           round integer not null,                         -- Round of the pick
                                           draft_slot integer not null,                    -- Column of the draft board
                                           original_roster_id integer not null,            -- Roster the pick was issued to; what traded picks name
                                           roster_id integer not null,                     -- Roster that made the pick
                                           player_id text not null,                        -- Sleeper player ID
                                           player_name text not null,                      -- Name as Sleeper had it at the draft
                                           position text not null                          -- Position as Sleeper had it at the draft
);

create unique index if not exists idx_draft_picks_draft_pick on draft_picks(draft_id, pick_no);
create index if not exists idx_draft_picks_player on draft_picks(player_id);

-- Every NFL player who has been through the league: drafted, traded, claimed
-- or dropped. Transactions and picks name players by Sleeper id only. Filled
-- weekly by the sync-players GitHub Action, since Sleeper's full player list
-- is too big for the Worker to parse on the free plan.
create table if not exists players (
                                       id text primary key,                            -- Sleeper player ID (a team abbreviation for a defense)
                                       name text not null,                             -- Current name
                                       position text,                                  -- Current position
                                       team text,                                      -- Current NFL team, null for a free agent or retired player
                                       updated_at timestamptz default now() not null   -- When the sync last wrote the row
);

-- Only the Worker reads and writes these, with the service role key, which
-- bypasses RLS. Enabling it with no policies keeps them out of reach of the
-- public anon key, as with users and matchups.
alter table rosters enable row level security;
alter table transactions enable row level security;
alter table draft_picks enable row level security;
alter table players enable row level security;

-- Every transaction that moved one player, or the pick he was drafted with,
-- for the player page. PostgREST has no filter for "this key is in the jsonb
-- object", and reading every transaction per player would not fit the
-- Worker's CPU budget. A traded pick is named by the roster it was issued to,
-- which is what draft_picks.original_roster_id records. Only the service
-- role may call it.
create or replace function player_transactions(player_id text)
returns setof transactions
language sql
stable
security invoker
set search_path = public
as $$
  select t.* from transactions t
  where t.adds ? player_id or t.drops ? player_id
  union
  select t.* from transactions t
  join draft_picks d on d.player_id = player_transactions.player_id
  where t.type = 'trade' and t.status = 'complete'
    and t.draft_picks @> jsonb_build_array(jsonb_build_object(
      'season', d.year::text, 'round', d.round, 'roster_id', d.original_roster_id))
$$;
revoke execute on function player_transactions(text) from public, anon, authenticated;

CREATE OR REPLACE VIEW career_stats with (security_invoker = on) AS
SELECT
    u.id AS user_id,
    u.name AS user_name,
    u.discord_id,

    -- Seasons Played
    COUNT(DISTINCT CASE WHEN u.id IN (m.home_user_id, m.away_user_id) THEN m.year END) AS seasons_played,

    -- Regular Season Wins
    COUNT(CASE WHEN m.is_playoff = FALSE AND m.home_score > m.away_score AND m.home_user_id = u.id THEN 1 END) +
    COUNT(CASE WHEN m.is_playoff = FALSE AND m.home_score < m.away_score AND m.away_user_id = u.id THEN 1 END) AS regular_season_wins,

    -- Regular Season Losses
    COUNT(CASE WHEN m.is_playoff = FALSE AND m.home_score < m.away_score AND m.home_user_id = u.id THEN 1 END) +
    COUNT(CASE WHEN m.is_playoff = FALSE AND m.home_score > m.away_score AND m.away_user_id = u.id THEN 1 END) AS regular_season_losses,

    -- Regular Season Average Points
    CAST(
            SUM(CASE
                    WHEN m.is_playoff = FALSE AND m.home_user_id = u.id THEN m.home_score
                    WHEN m.is_playoff = FALSE AND m.away_user_id = u.id THEN m.away_score
                END) * 1.0 /
            NULLIF(COUNT(CASE
                             WHEN m.is_playoff = FALSE AND (m.home_user_id = u.id OR m.away_user_id = u.id) THEN 1
                END), 0)
        AS FLOAT) AS regular_season_avg_points,

    -- Regular Season Points For/Against
    COALESCE(SUM(CASE
                     WHEN m.is_playoff = FALSE AND m.home_user_id = u.id THEN m.home_score
                     WHEN m.is_playoff = FALSE AND m.away_user_id = u.id THEN m.away_score
        END)::FLOAT, 0) AS regular_season_points_for,

    COALESCE(SUM(CASE
                     WHEN m.is_playoff = FALSE AND m.home_user_id = u.id THEN m.away_score
                     WHEN m.is_playoff = FALSE AND m.away_user_id = u.id THEN m.home_score
        END)::FLOAT, 0) AS regular_season_points_against,

    -- Highest Regular Season Score: this owner's own score, not the higher
    -- of the two in a game they played (which could be the opponent's).
    MAX(CASE
            WHEN m.is_playoff = FALSE AND m.home_user_id = u.id THEN m.home_score
            WHEN m.is_playoff = FALSE AND m.away_user_id = u.id THEN m.away_score
        END)::FLOAT AS highest_regular_season_score,

    -- Weekly High Scores
    (
        SELECT COUNT(*)
        FROM (
                 SELECT m.year, m.week,
                        CASE
                            WHEN m.home_user_id = u.id THEN m.home_score
                            WHEN m.away_user_id = u.id THEN m.away_score
                            END AS user_score
                 FROM matchups m
                 WHERE (m.home_user_id = u.id OR m.away_user_id = u.id) AND m.is_playoff = FALSE
             ) user_scores
                 JOIN (
            SELECT year, week, MAX(GREATEST(home_score, away_score)) AS max_score
            FROM matchups
            WHERE is_playoff = FALSE
            GROUP BY year, week
        ) weekly_maxes
                      ON user_scores.year = weekly_maxes.year AND user_scores.week = weekly_maxes.week
        WHERE user_scores.user_score = weekly_maxes.max_score
    ) AS weekly_high_scores,

    -- Playoff Stats
    COUNT(DISTINCT CASE WHEN m.is_playoff = TRUE THEN m.year END) AS playoff_appearances,

    COUNT(CASE WHEN m.is_playoff = TRUE AND m.home_score > m.away_score AND m.home_user_id = u.id THEN 1 END) +
    COUNT(CASE WHEN m.is_playoff = TRUE AND m.home_score < m.away_score AND m.away_user_id = u.id THEN 1 END) AS playoff_wins,

    COUNT(CASE WHEN m.is_playoff = TRUE AND m.home_score < m.away_score AND m.home_user_id = u.id THEN 1 END) +
    COUNT(CASE WHEN m.is_playoff = TRUE AND m.home_score > m.away_score AND m.away_user_id = u.id THEN 1 END) AS playoff_losses,

    COUNT(DISTINCT CASE WHEN m.is_playoff = TRUE AND m.playoff_round = 'quarterfinal' THEN m.year END) AS quarterfinal_appearances,
    COUNT(DISTINCT CASE WHEN m.is_playoff = TRUE AND m.playoff_round = 'semifinal' THEN m.year END) AS semifinal_appearances,
    COUNT(DISTINCT CASE WHEN m.is_playoff = TRUE AND m.playoff_round = 'final' THEN m.year END) AS finals_appearances,

    -- Podium Finishes
    COUNT(CASE
              WHEN m.is_playoff = TRUE AND m.playoff_round = 'final' AND (
                  (m.home_score > m.away_score AND m.home_user_id = u.id) OR
                  (m.away_score > m.home_score AND m.away_user_id = u.id)
                  ) THEN 1
        END) AS first_place_finishes,

    COUNT(CASE
              WHEN m.is_playoff = TRUE AND m.playoff_round = 'final' AND (
                  (m.home_score < m.away_score AND m.home_user_id = u.id) OR
                  (m.away_score < m.home_score AND m.away_user_id = u.id)
                  ) THEN 1
        END) AS second_place_finishes,

    COUNT(CASE
              WHEN m.is_playoff = TRUE AND m.playoff_round = 'third_place' AND (
                  (m.home_score > m.away_score AND m.home_user_id = u.id) OR
                  (m.away_score > m.home_score AND m.away_user_id = u.id)
                  ) THEN 1
        END) AS third_place_finishes,

    -- Playoff Points
    COALESCE(SUM(CASE
                     WHEN m.is_playoff = TRUE AND m.home_user_id = u.id THEN m.home_score
                     WHEN m.is_playoff = TRUE AND m.away_user_id = u.id THEN m.away_score
        END)::FLOAT, 0) AS playoff_points_for,

    COALESCE(SUM(CASE
                     WHEN m.is_playoff = TRUE AND m.home_user_id = u.id THEN m.away_score
                     WHEN m.is_playoff = TRUE AND m.away_user_id = u.id THEN m.home_score
        END)::FLOAT, 0) AS playoff_points_against,

    -- Playoff Average Points
    COALESCE(
            CAST(
                    SUM(CASE
                            WHEN m.is_playoff = TRUE AND m.home_user_id = u.id THEN m.home_score
                            WHEN m.is_playoff = TRUE AND m.away_user_id = u.id THEN m.away_score
                        END) * 1.0 /
                    NULLIF(COUNT(CASE
                                     WHEN m.is_playoff = TRUE AND (m.home_user_id = u.id OR m.away_user_id = u.id) THEN 1
                        END), 0)
                AS FLOAT),
            0) AS playoff_avg_points

FROM users u
         JOIN matchups m ON m.home_user_id = u.id OR m.away_user_id = u.id
GROUP BY u.id, u.name, u.discord_id;

CREATE TABLE IF NOT EXISTS users (
                                     id TEXT PRIMARY KEY,                       -- Discord ID (this can be your user ID in Discord)
                                     name TEXT NOT NULL,                        -- Name of the user
                                     discord_id TEXT DEFAULT '' NOT NULL,       -- Discord username or ID
                                     created_at TIMESTAMPTZ DEFAULT NOW()       -- Timestamp when the user joined
);

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

    -- Highest Regular Season Score
    MAX(CASE WHEN m.is_playoff = FALSE THEN GREATEST(m.home_score, m.away_score) END)::FLOAT AS highest_regular_season_score,

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

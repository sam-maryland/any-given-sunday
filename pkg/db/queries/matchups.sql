-- name: GetMatchupsByYear :many
SELECT
    id,
    year,
    week,
    is_playoff,
    playoff_round,
    home_user_id,
    away_user_id,
    home_seed,
    away_seed,
    home_score,
    away_score
FROM matchups
WHERE year = $1
ORDER BY week ASC, id ASC;

-- name: GetWeeklyHighScore :one
SELECT 
    CASE 
        WHEN home_score > away_score THEN home_user_id 
        ELSE away_user_id 
    END::TEXT AS winner_user_id,
    CASE 
        WHEN home_score > away_score THEN home_score 
        ELSE away_score 
    END::FLOAT AS winning_score,
    year,
    week
FROM matchups 
WHERE year = $1 AND week = $2 AND is_playoff = FALSE
ORDER BY GREATEST(home_score, away_score) DESC 
LIMIT 1;

-- name: GetLatestCompletedWeek :one  
SELECT COALESCE(MAX(week), 0)::INTEGER as latest_week
FROM matchups
WHERE year = $1 AND is_playoff = FALSE;

-- name: InsertMatchup :one
INSERT INTO matchups (
    year,
    week,
    is_playoff,
    playoff_round,
    home_user_id,
    away_user_id,
    home_seed,
    away_seed,
    home_score,
    away_score
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
) RETURNING id;

-- name: UpdateMatchupScores :exec
UPDATE matchups 
SET home_score = $3, away_score = $4
WHERE year = $1 AND week = $2 AND home_user_id = $5 AND away_user_id = $6;

-- name: GetMatchupByYearWeekUsers :one
SELECT * FROM matchups 
WHERE year = $1 AND week = $2 AND home_user_id = $3 AND away_user_id = $4;

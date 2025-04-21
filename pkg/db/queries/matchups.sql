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

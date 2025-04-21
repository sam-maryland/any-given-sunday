-- name: GetHighScoreCounts :many
SELECT
    u.id AS user_id,
    u.name AS user_name,
    COALESCE(high_scores.count, 0) AS high_score_count
FROM users u
         LEFT JOIN (
    SELECT
        winner.user_id,
        COUNT(*) AS count
    FROM (
             SELECT
                 year,
                 week,
                 CASE
                     WHEN home_score >= away_score THEN home_user_id
                     ELSE away_user_id
                     END AS user_id,
                 GREATEST(home_score, away_score) AS score
             FROM matchups
             WHERE is_playoff = false
         ) AS winner
             JOIN (
        SELECT
            year,
            week,
            MAX(GREATEST(home_score, away_score)) AS max_score
        FROM matchups
        WHERE is_playoff = false
        GROUP BY year, week
    ) AS weekly_max
                  ON winner.year = weekly_max.year
                      AND winner.week = weekly_max.week
                      AND winner.score = weekly_max.max_score
    GROUP BY winner.user_id
) AS high_scores
                   ON u.id = high_scores.user_id
ORDER BY high_score_count DESC;

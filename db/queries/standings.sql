-- name: GetRawStandings :many
WITH all_matchups AS (
    SELECT
        m.home_user_id AS user_id,
        m.away_user_id AS opponent_id,
        m.home_score AS points_for,
        m.away_score AS points_against,
        CASE
            WHEN m.home_score > m.away_score THEN 1
            ELSE 0
            END AS win,
        CASE
            WHEN m.home_score < m.away_score THEN 1
            ELSE 0
            END AS loss,
        CASE
            WHEN m.home_score = m.away_score THEN 1
            ELSE 0
            END AS tie
    FROM matchups m
    WHERE m.year = $1 AND NOT m.is_playoff

    UNION ALL

    SELECT
        m.away_user_id AS user_id,
        m.home_user_id AS opponent_id,
        m.away_score AS points_for,
        m.home_score AS points_against,
        CASE
            WHEN m.away_score > m.home_score THEN 1
            ELSE 0
            END AS win,
        CASE
            WHEN m.away_score < m.home_score THEN 1
            ELSE 0
            END AS loss,
        CASE
            WHEN m.away_score = m.home_score THEN 1
            ELSE 0
            END AS tie
    FROM matchups m
    WHERE m.year = $1 AND NOT m.is_playoff
)

SELECT
    user_id,
    SUM(win) AS wins,
    SUM(loss) AS losses,
    SUM(tie) AS ties,
    CAST(SUM(points_for) AS FLOAT) AS points_for,  -- Cast to INT
    CAST(SUM(points_against) AS FLOAT) AS points_against  -- Cast to INT
-- You can also add more calculations here like Points For, Points Against, etc.
FROM all_matchups
GROUP BY user_id
ORDER BY points_for DESC, wins DESC;

-- name: GetLeagueByYear :one
SELECT * FROM leagues WHERE year = $1;

-- name: GetLatestLeagueYear :one
SELECT year FROM (
    (
        SELECT year
        FROM leagues
        WHERE status = 'IN_PROGRESS'
        ORDER BY year DESC
        LIMIT 1
    )
    UNION ALL
    (
        SELECT year
        FROM leagues
        WHERE status = 'COMPLETE'
        ORDER BY year DESC
        LIMIT 1
    )
) AS combined
LIMIT 1;


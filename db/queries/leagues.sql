-- name: GetLeagueByYear :one
SELECT * FROM leagues WHERE year = $1;

-- name: GetLatestLeague :one
SELECT * FROM (
    (
        SELECT *
        FROM leagues
        WHERE status = 'IN_PROGRESS'
        ORDER BY year DESC
        LIMIT 1
    )
    UNION ALL
    (
        SELECT *
        FROM leagues
        WHERE status = 'COMPLETE'
        ORDER BY year DESC
        LIMIT 1
    )
) AS combined
LIMIT 1;


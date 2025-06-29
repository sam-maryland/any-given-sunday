// Code generated by sqlc. DO NOT EDIT.
// versions:
//   sqlc v1.29.0
// source: leagues.sql

package db

import (
	"context"
)

const getLatestLeague = `-- name: GetLatestLeague :one
SELECT id, year, first_place, second_place, third_place, status FROM (
    (
        SELECT id, year, first_place, second_place, third_place, status
        FROM leagues
        WHERE status = 'IN_PROGRESS'
        ORDER BY year DESC
        LIMIT 1
    )
    UNION ALL
    (
        SELECT id, year, first_place, second_place, third_place, status
        FROM leagues
        WHERE status = 'COMPLETE'
        ORDER BY year DESC
        LIMIT 1
    )
) AS combined
LIMIT 1
`

func (q *Queries) GetLatestLeague(ctx context.Context) (League, error) {
	row := q.db.QueryRow(ctx, getLatestLeague)
	var i League
	err := row.Scan(
		&i.ID,
		&i.Year,
		&i.FirstPlace,
		&i.SecondPlace,
		&i.ThirdPlace,
		&i.Status,
	)
	return i, err
}

const getLeagueByYear = `-- name: GetLeagueByYear :one
SELECT id, year, first_place, second_place, third_place, status FROM leagues WHERE year = $1
`

func (q *Queries) GetLeagueByYear(ctx context.Context, year int32) (League, error) {
	row := q.db.QueryRow(ctx, getLeagueByYear, year)
	var i League
	err := row.Scan(
		&i.ID,
		&i.Year,
		&i.FirstPlace,
		&i.SecondPlace,
		&i.ThirdPlace,
		&i.Status,
	)
	return i, err
}

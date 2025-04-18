// Code generated by sqlc. DO NOT EDIT.
// versions:
//   sqlc v1.28.0
// source: team_stats.sql

package db

import (
	"context"
)

const getAllCareerStats = `-- name: GetAllCareerStats :many
SELECT user_id, user_name, discord_id, seasons_played, regular_season_wins, regular_season_losses, regular_season_avg_points, regular_season_points_for, regular_season_points_against, highest_regular_season_score, weekly_high_scores, playoff_appearances, playoff_wins, playoff_losses, quarterfinal_appearances, semifinal_appearances, finals_appearances, first_place_finishes, second_place_finishes, third_place_finishes, playoff_points_for, playoff_points_against, playoff_avg_points FROM career_stats
`

func (q *Queries) GetAllCareerStats(ctx context.Context) ([]CareerStat, error) {
	rows, err := q.db.Query(ctx, getAllCareerStats)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []CareerStat
	for rows.Next() {
		var i CareerStat
		if err := rows.Scan(
			&i.UserID,
			&i.UserName,
			&i.DiscordID,
			&i.SeasonsPlayed,
			&i.RegularSeasonWins,
			&i.RegularSeasonLosses,
			&i.RegularSeasonAvgPoints,
			&i.RegularSeasonPointsFor,
			&i.RegularSeasonPointsAgainst,
			&i.HighestRegularSeasonScore,
			&i.WeeklyHighScores,
			&i.PlayoffAppearances,
			&i.PlayoffWins,
			&i.PlayoffLosses,
			&i.QuarterfinalAppearances,
			&i.SemifinalAppearances,
			&i.FinalsAppearances,
			&i.FirstPlaceFinishes,
			&i.SecondPlaceFinishes,
			&i.ThirdPlaceFinishes,
			&i.PlayoffPointsFor,
			&i.PlayoffPointsAgainst,
			&i.PlayoffAvgPoints,
		); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

const getCareerStatsByDiscordID = `-- name: GetCareerStatsByDiscordID :one
SELECT user_id, user_name, discord_id, seasons_played, regular_season_wins, regular_season_losses, regular_season_avg_points, regular_season_points_for, regular_season_points_against, highest_regular_season_score, weekly_high_scores, playoff_appearances, playoff_wins, playoff_losses, quarterfinal_appearances, semifinal_appearances, finals_appearances, first_place_finishes, second_place_finishes, third_place_finishes, playoff_points_for, playoff_points_against, playoff_avg_points FROM career_stats WHERE discord_id = $1
`

func (q *Queries) GetCareerStatsByDiscordID(ctx context.Context, discordID string) (CareerStat, error) {
	row := q.db.QueryRow(ctx, getCareerStatsByDiscordID, discordID)
	var i CareerStat
	err := row.Scan(
		&i.UserID,
		&i.UserName,
		&i.DiscordID,
		&i.SeasonsPlayed,
		&i.RegularSeasonWins,
		&i.RegularSeasonLosses,
		&i.RegularSeasonAvgPoints,
		&i.RegularSeasonPointsFor,
		&i.RegularSeasonPointsAgainst,
		&i.HighestRegularSeasonScore,
		&i.WeeklyHighScores,
		&i.PlayoffAppearances,
		&i.PlayoffWins,
		&i.PlayoffLosses,
		&i.QuarterfinalAppearances,
		&i.SemifinalAppearances,
		&i.FinalsAppearances,
		&i.FirstPlaceFinishes,
		&i.SecondPlaceFinishes,
		&i.ThirdPlaceFinishes,
		&i.PlayoffPointsFor,
		&i.PlayoffPointsAgainst,
		&i.PlayoffAvgPoints,
	)
	return i, err
}

const getCareerStatsBySleeperUserID = `-- name: GetCareerStatsBySleeperUserID :one
SELECT user_id, user_name, discord_id, seasons_played, regular_season_wins, regular_season_losses, regular_season_avg_points, regular_season_points_for, regular_season_points_against, highest_regular_season_score, weekly_high_scores, playoff_appearances, playoff_wins, playoff_losses, quarterfinal_appearances, semifinal_appearances, finals_appearances, first_place_finishes, second_place_finishes, third_place_finishes, playoff_points_for, playoff_points_against, playoff_avg_points FROM career_stats WHERE user_id = $1
`

func (q *Queries) GetCareerStatsBySleeperUserID(ctx context.Context, userID string) (CareerStat, error) {
	row := q.db.QueryRow(ctx, getCareerStatsBySleeperUserID, userID)
	var i CareerStat
	err := row.Scan(
		&i.UserID,
		&i.UserName,
		&i.DiscordID,
		&i.SeasonsPlayed,
		&i.RegularSeasonWins,
		&i.RegularSeasonLosses,
		&i.RegularSeasonAvgPoints,
		&i.RegularSeasonPointsFor,
		&i.RegularSeasonPointsAgainst,
		&i.HighestRegularSeasonScore,
		&i.WeeklyHighScores,
		&i.PlayoffAppearances,
		&i.PlayoffWins,
		&i.PlayoffLosses,
		&i.QuarterfinalAppearances,
		&i.SemifinalAppearances,
		&i.FinalsAppearances,
		&i.FirstPlaceFinishes,
		&i.SecondPlaceFinishes,
		&i.ThirdPlaceFinishes,
		&i.PlayoffPointsFor,
		&i.PlayoffPointsAgainst,
		&i.PlayoffAvgPoints,
	)
	return i, err
}

// Code generated by sqlc. DO NOT EDIT.
// versions:
//   sqlc v1.28.0

package db

import (
	"github.com/jackc/pgx/v5/pgtype"
)

type CareerStat struct {
	UserID                     string
	UserName                   string
	DiscordID                  string
	SeasonsPlayed              int64
	RegularSeasonWins          int32
	RegularSeasonLosses        int32
	RegularSeasonAvgPoints     float64
	RegularSeasonPointsFor     interface{}
	RegularSeasonPointsAgainst interface{}
	HighestRegularSeasonScore  float64
	WeeklyHighScores           int64
	PlayoffAppearances         int64
	PlayoffWins                int32
	PlayoffLosses              int32
	QuarterfinalAppearances    int64
	SemifinalAppearances       int64
	FinalsAppearances          int64
	FirstPlaceFinishes         int64
	SecondPlaceFinishes        int64
	ThirdPlaceFinishes         int64
	PlayoffPointsFor           interface{}
	PlayoffPointsAgainst       interface{}
	PlayoffAvgPoints           interface{}
}

type League struct {
	ID          string
	Year        int32
	FirstPlace  string
	SecondPlace string
	ThirdPlace  string
	Status      string
}

type Matchup struct {
	ID           pgtype.UUID
	Year         int32
	Week         int32
	IsPlayoff    pgtype.Bool
	PlayoffRound pgtype.Text
	HomeUserID   string
	AwayUserID   string
	HomeSeed     pgtype.Int4
	AwaySeed     pgtype.Int4
	HomeScore    float64
	AwayScore    float64
}

type User struct {
	ID        string
	Name      string
	DiscordID string
	CreatedAt pgtype.Timestamptz
}

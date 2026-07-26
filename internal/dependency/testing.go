package dependency

import (
	"context"

	"github.com/sam-maryland/any-given-sunday/pkg/client/sleeper"
	"github.com/sam-maryland/any-given-sunday/pkg/db"

	"github.com/jackc/pgx/v5/pgtype"
)

// IDatabase wraps the SQLC generated Queries for testing
type IDatabase interface {
	// League operations
	GetLatestLeague(ctx context.Context) (db.League, error)
	GetLeagueByYear(ctx context.Context, year int32) (db.League, error)

	// User operations
	GetUserByID(ctx context.Context, id string) (db.User, error)
	GetUsers(ctx context.Context) ([]db.User, error)

	// Matchup operations
	GetLatestCompletedWeek(ctx context.Context, year int32) (int32, error)
	GetMatchupByYearWeekUsers(ctx context.Context, arg db.GetMatchupByYearWeekUsersParams) (db.Matchup, error)
	GetMatchupsByYear(ctx context.Context, year int32) ([]db.Matchup, error)
	GetWeeklyHighScore(ctx context.Context, arg db.GetWeeklyHighScoreParams) (db.GetWeeklyHighScoreRow, error)
	InsertMatchup(ctx context.Context, arg db.InsertMatchupParams) (pgtype.UUID, error)
	UpdateMatchupScores(ctx context.Context, arg db.UpdateMatchupScoresParams) error
}

// ISleeperClient aliases the sleeper client interface for testing
type ISleeperClient interface {
	sleeper.ISleeperClient
}

// TestChain provides a dependency chain for testing with interfaces
type TestChain struct {
	DB            IDatabase
	SleeperClient ISleeperClient
}

// NewTestChain creates a new test dependency chain with the provided mocks
func NewTestChain(db IDatabase, sleeperClient ISleeperClient) *TestChain {
	return &TestChain{
		DB:            db,
		SleeperClient: sleeperClient,
	}
}

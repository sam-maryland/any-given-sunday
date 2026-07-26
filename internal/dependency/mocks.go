package dependency

import (
	"context"

	"github.com/sam-maryland/any-given-sunday/pkg/client/sleeper"
	"github.com/sam-maryland/any-given-sunday/pkg/db"

	"github.com/jackc/pgx/v5/pgtype"
)

// MockDatabase provides a mock implementation of IDatabase for testing
type MockDatabase struct {
	// Leagues
	GetLatestLeagueFunc func(ctx context.Context) (db.League, error)
	GetLeagueByYearFunc func(ctx context.Context, year int32) (db.League, error)

	// Users
	GetUserByIDFunc func(ctx context.Context, id string) (db.User, error)
	GetUsersFunc    func(ctx context.Context) ([]db.User, error)

	// Matchups
	GetLatestCompletedWeekFunc    func(ctx context.Context, year int32) (int32, error)
	GetMatchupByYearWeekUsersFunc func(ctx context.Context, arg db.GetMatchupByYearWeekUsersParams) (db.Matchup, error)
	GetMatchupsByYearFunc         func(ctx context.Context, year int32) ([]db.Matchup, error)
	GetWeeklyHighScoreFunc        func(ctx context.Context, arg db.GetWeeklyHighScoreParams) (db.GetWeeklyHighScoreRow, error)
	InsertMatchupFunc             func(ctx context.Context, arg db.InsertMatchupParams) (pgtype.UUID, error)
	UpdateMatchupScoresFunc       func(ctx context.Context, arg db.UpdateMatchupScoresParams) error
}

func (m *MockDatabase) GetLatestLeague(ctx context.Context) (db.League, error) {
	if m.GetLatestLeagueFunc != nil {
		return m.GetLatestLeagueFunc(ctx)
	}
	return db.League{}, nil
}

func (m *MockDatabase) GetLeagueByYear(ctx context.Context, year int32) (db.League, error) {
	if m.GetLeagueByYearFunc != nil {
		return m.GetLeagueByYearFunc(ctx, year)
	}
	return db.League{}, nil
}

func (m *MockDatabase) GetUserByID(ctx context.Context, id string) (db.User, error) {
	if m.GetUserByIDFunc != nil {
		return m.GetUserByIDFunc(ctx, id)
	}
	return db.User{}, nil
}

func (m *MockDatabase) GetUsers(ctx context.Context) ([]db.User, error) {
	if m.GetUsersFunc != nil {
		return m.GetUsersFunc(ctx)
	}
	return []db.User{}, nil
}

func (m *MockDatabase) GetLatestCompletedWeek(ctx context.Context, year int32) (int32, error) {
	if m.GetLatestCompletedWeekFunc != nil {
		return m.GetLatestCompletedWeekFunc(ctx, year)
	}
	return 0, nil
}

func (m *MockDatabase) GetMatchupByYearWeekUsers(ctx context.Context, arg db.GetMatchupByYearWeekUsersParams) (db.Matchup, error) {
	if m.GetMatchupByYearWeekUsersFunc != nil {
		return m.GetMatchupByYearWeekUsersFunc(ctx, arg)
	}
	return db.Matchup{}, nil
}

func (m *MockDatabase) GetMatchupsByYear(ctx context.Context, year int32) ([]db.Matchup, error) {
	if m.GetMatchupsByYearFunc != nil {
		return m.GetMatchupsByYearFunc(ctx, year)
	}
	return []db.Matchup{}, nil
}

func (m *MockDatabase) GetWeeklyHighScore(ctx context.Context, arg db.GetWeeklyHighScoreParams) (db.GetWeeklyHighScoreRow, error) {
	if m.GetWeeklyHighScoreFunc != nil {
		return m.GetWeeklyHighScoreFunc(ctx, arg)
	}
	return db.GetWeeklyHighScoreRow{}, nil
}

func (m *MockDatabase) InsertMatchup(ctx context.Context, arg db.InsertMatchupParams) (pgtype.UUID, error) {
	if m.InsertMatchupFunc != nil {
		return m.InsertMatchupFunc(ctx, arg)
	}
	return pgtype.UUID{}, nil
}

func (m *MockDatabase) UpdateMatchupScores(ctx context.Context, arg db.UpdateMatchupScoresParams) error {
	if m.UpdateMatchupScoresFunc != nil {
		return m.UpdateMatchupScoresFunc(ctx, arg)
	}
	return nil
}

// MockSleeperClient provides a mock implementation for testing
type MockSleeperClient struct {
	GetUserFunc            func(ctx context.Context, userID string) (sleeper.SleeperUser, error)
	GetLeagueFunc          func(ctx context.Context, leagueID string) (sleeper.SleeperLeague, error)
	GetUsersInLeagueFunc   func(ctx context.Context, leagueID string) (sleeper.SleeperUsers, error)
	GetRostersInLeagueFunc func(ctx context.Context, leagueID string) (sleeper.Rosters, error)
	GetMatchupsForWeekFunc func(ctx context.Context, leagueID string, week int) (sleeper.Matchups, error)
	GetNFLStateFunc        func(ctx context.Context) (sleeper.NFLState, error)
	FetchAllPlayersFunc    func(ctx context.Context) ([]byte, error)
}

func (m *MockSleeperClient) GetUser(ctx context.Context, userID string) (sleeper.SleeperUser, error) {
	if m.GetUserFunc != nil {
		return m.GetUserFunc(ctx, userID)
	}
	return sleeper.SleeperUser{}, nil
}

func (m *MockSleeperClient) GetLeague(ctx context.Context, leagueID string) (sleeper.SleeperLeague, error) {
	if m.GetLeagueFunc != nil {
		return m.GetLeagueFunc(ctx, leagueID)
	}
	return sleeper.SleeperLeague{}, nil
}

func (m *MockSleeperClient) GetUsersInLeague(ctx context.Context, leagueID string) (sleeper.SleeperUsers, error) {
	if m.GetUsersInLeagueFunc != nil {
		return m.GetUsersInLeagueFunc(ctx, leagueID)
	}
	return sleeper.SleeperUsers{}, nil
}

func (m *MockSleeperClient) GetRostersInLeague(ctx context.Context, leagueID string) (sleeper.Rosters, error) {
	if m.GetRostersInLeagueFunc != nil {
		return m.GetRostersInLeagueFunc(ctx, leagueID)
	}
	return sleeper.Rosters{}, nil
}

func (m *MockSleeperClient) GetMatchupsForWeek(ctx context.Context, leagueID string, week int) (sleeper.Matchups, error) {
	if m.GetMatchupsForWeekFunc != nil {
		return m.GetMatchupsForWeekFunc(ctx, leagueID, week)
	}
	return sleeper.Matchups{}, nil
}

func (m *MockSleeperClient) GetNFLState(ctx context.Context) (sleeper.NFLState, error) {
	if m.GetNFLStateFunc != nil {
		return m.GetNFLStateFunc(ctx)
	}
	return sleeper.NFLState{}, nil
}

func (m *MockSleeperClient) FetchAllPlayers(ctx context.Context) ([]byte, error) {
	if m.FetchAllPlayersFunc != nil {
		return m.FetchAllPlayersFunc(ctx)
	}
	return []byte{}, nil
}

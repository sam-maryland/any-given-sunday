package dependency

import (
	"context"

	"github.com/sam-maryland/any-given-sunday/pkg/client/sleeper"
	"github.com/sam-maryland/any-given-sunday/pkg/db"

	"github.com/bwmarrin/discordgo"
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

	// Team stats operations
	GetCareerStatsByDiscordID(ctx context.Context, discordID string) (db.CareerStat, error)

	// Onboarding operations
	GetUsersWithoutDiscordID(ctx context.Context) ([]db.User, error)
	UpdateUserDiscordID(ctx context.Context, arg db.UpdateUserDiscordIDParams) error
	IsUserOnboarded(ctx context.Context, discordID string) (bool, error)
	GetUserByDiscordID(ctx context.Context, discordID string) (db.User, error)
	CheckSleeperUserClaimed(ctx context.Context, id string) (bool, error)
}

// ISleeperClient aliases the sleeper client interface for testing
type ISleeperClient interface {
	sleeper.ISleeperClient
}

// IDiscordSession wraps discordgo.Session for testing
type IDiscordSession interface {
	InteractionRespond(interaction *discordgo.Interaction, resp *discordgo.InteractionResponse, options ...discordgo.RequestOption) error
	GuildMember(guildID, userID string, options ...discordgo.RequestOption) (*discordgo.Member, error)
	ApplicationCommandCreate(appID string, guildID string, cmd *discordgo.ApplicationCommand, options ...discordgo.RequestOption) (*discordgo.ApplicationCommand, error)
	AddHandler(handler interface{}) func()
	Open() error
	Close() error
	ChannelMessageSendComplex(channelID string, data *discordgo.MessageSend) (*discordgo.Message, error)
	ChannelMessageSend(channelID, content string) (*discordgo.Message, error)
}

// TestChain provides a dependency chain for testing with interfaces
type TestChain struct {
	DB            IDatabase
	SleeperClient ISleeperClient
	Discord       IDiscordSession
}

// NewTestChain creates a new test dependency chain with the provided mocks
func NewTestChain(db IDatabase, sleeperClient ISleeperClient, discord IDiscordSession) *TestChain {
	return &TestChain{
		DB:            db,
		SleeperClient: sleeperClient,
		Discord:       discord,
	}
}

// DatabaseWrapper wraps the real Queries struct to implement IDatabase
type DatabaseWrapper struct {
	*db.Queries
}

// NewDatabaseWrapper creates a wrapper around the real database queries
func NewDatabaseWrapper(q *db.Queries) IDatabase {
	return &DatabaseWrapper{Queries: q}
}

// DiscordWrapper wraps the real discordgo.Session to implement IDiscordSession
type DiscordWrapper struct {
	*discordgo.Session
}

// NewDiscordWrapper creates a wrapper around the real Discord session
func NewDiscordWrapper(session *discordgo.Session) IDiscordSession {
	return &DiscordWrapper{Session: session}
}

// ChannelMessageSendComplex wraps the Discord session method
func (d *DiscordWrapper) ChannelMessageSendComplex(channelID string, data *discordgo.MessageSend) (*discordgo.Message, error) {
	return d.Session.ChannelMessageSendComplex(channelID, data)
}

// ChannelMessageSend wraps the Discord session method 
func (d *DiscordWrapper) ChannelMessageSend(channelID, content string) (*discordgo.Message, error) {
	return d.Session.ChannelMessageSend(channelID, content)
}

// NewTestableChain converts a real Chain to use interfaces for testing compatibility
func NewTestableChain(chain *Chain) *TestChain {
	return &TestChain{
		DB:            NewDatabaseWrapper(chain.DB),
		SleeperClient: chain.SleeperClient,
		Discord:       NewDiscordWrapper(chain.Discord),
	}
}
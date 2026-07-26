package dependency

import (
	"github.com/sam-maryland/any-given-sunday/pkg/client/sleeper"
	"github.com/sam-maryland/any-given-sunday/pkg/db"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Chain struct {
	Pool          *pgxpool.Pool
	DB            *db.Queries
	SleeperClient *sleeper.SleeperClient
}

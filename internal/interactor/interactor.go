package interactor

import (
	"any-given-sunday/internal/db"
	"any-given-sunday/internal/dependency"
)

type interactor struct {
	*dependency.Chain
	*db.Queries
}

type Interactor interface {
	LeagueInteractor
	StatsInteractor
	UsersInteractor
}

func NewInteractor(c *dependency.Chain) *interactor {
	q := db.New(c.Pool)
	return &interactor{Chain: c, Queries: q}
}

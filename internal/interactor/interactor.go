package interactor

import (
	"github.com/sam-maryland/any-given-sunday/internal/dependency"
)

type interactor struct {
	*dependency.Chain
}

type Interactor interface {
	LeagueInteractor
	StatsInteractor
	UsersInteractor
	WeeklyJobInteractor
	OnboardingInteractor
}

func NewInteractor(c *dependency.Chain) *interactor {
	return &interactor{Chain: c}
}

package interactor

import "any-given-sunday/pkg/client/sleeper"

type interactor struct {
	*sleeper.SleeperClient
}

type Interactor interface {
	ReportInteractor
}

func NewInteractor(sc *sleeper.SleeperClient) *interactor {
	return &interactor{SleeperClient: sc}
}

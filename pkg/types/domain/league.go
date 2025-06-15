package domain

const (
	LeagueStatusInProgress = "IN_PROGRESS"
	LeagueStatusComplete   = "COMPLETE"
	LeagueStatusPending    = "PENDING"
)

type League struct {
	ID          string
	Year        int
	FirstPlace  string
	SecondPlace string
	ThirdPlace  string
	Status      string
}

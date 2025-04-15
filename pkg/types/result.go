package types

import "fmt"

type WeekResult struct {
	Week      int
	MatchupID int
	Score     UserScores
}

type UserScores map[string]float32

func (us UserScores) String() string {
	var result string
	for id, score := range us {
		result += fmt.Sprintf("%s: %.2f\n", id, score)
	}
	return result
}

func (wr WeekResult) WinnerAndLoser() (winnerID, loserID string, tie bool) {
	var ids []string
	var scores []float32

	for id, score := range wr.Score {
		ids = append(ids, id)
		scores = append(scores, score)
	}

	if len(scores) != 2 {
		return "", "", false // not a valid head-to-head
	}

	if scores[0] > scores[1] {
		return ids[0], ids[1], false
	} else if scores[1] > scores[0] {
		return ids[1], ids[0], false
	}

	// Tie
	return ids[0], ids[1], true
}

func (wr WeekResult) String(users UserMap) string {
	w, l, tied := wr.WinnerAndLoser()
	if tied {
		return fmt.Sprintf("%s (%.2f) tied %s (%.2f)", users[w].ID, wr.Score[w], users[l].ID, wr.Score[l])
	} else {
		return fmt.Sprintf("%s (%.2f) def %s (%.2f)", users[w].ID, wr.Score[w], users[l].ID, wr.Score[l])
	}
}

type WeekResults []WeekResult

func (wr WeekResults) String(users UserMap) string {
	var result string
	for _, w := range wr {
		result += fmt.Sprintf("%s\n", w.String(users))
	}
	return result
}

func (wr WeekResults) Scores() UserScores {
	scores := make(UserScores)
	for _, w := range wr {
		for id, score := range w.Score {
			scores[id] = score
		}
	}
	return scores
}

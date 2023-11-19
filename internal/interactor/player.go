package interactor

import (
	"any-given-sunday/pkg/types"
	"context"
	"encoding/json"
	"os"
)

type PlayerInteractor interface {
	LoadAllPlayers(ctx context.Context) (map[string]types.Player, error)
}

func (i *interactor) LoadAllPlayers(ctx context.Context) (map[string]types.Player, error) {
	f, err := os.ReadFile("./pkg/data/playerdata.json")
	if err != nil {
		return nil, err
	}

	pm := make(map[string]types.Player)
	if err := json.Unmarshal(f, &pm); err != nil {
		return nil, err
	}

	return pm, nil
}

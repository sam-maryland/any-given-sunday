package sleeper

import (
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/sam-maryland/any-given-sunday/pkg/chttp"
	"github.com/sam-maryland/any-given-sunday/pkg/types"
)

var (
	baseURL = "https://api.sleeper.app/v1/"
)

type ISleeperClient interface {
	GetUser(ctx context.Context, userID string) (types.SleeperUser, error)

	GetLeague(ctx context.Context, leagueID string) (types.SleeperLeague, error)
	GetUsersInLeague(ctx context.Context, leagueID string) (types.Users, error)
	GetRostersInLeague(ctx context.Context, leagueID string) (types.Rosters, error)

	GetMatchupsForWeek(ctx context.Context, leagueID string, week int) (types.Matchups, error)

	GetNFLState(ctx context.Context) (types.NFLState, error)
	FetchAllPlayers(ctx context.Context) (map[string]types.Player, error)
}

type SleeperClient struct {
	httpClient *http.Client
}

func NewSleeperClient(c *http.Client) *SleeperClient {
	return &SleeperClient{httpClient: c}
}

func (c *SleeperClient) GetUser(ctx context.Context, userID string) (types.SleeperUser, error) {
	u := fmt.Sprintf("%s/user/%s", baseURL, userID)

	req, err := chttp.NewJSONRequest(ctx, http.MethodGet, u, nil)
	if err != nil {
		return types.SleeperUser{}, err
	}

	res, err := c.httpClient.Do(req)

	user := &types.SleeperUser{}
	if err := chttp.JSONResponder(res, err, user); err != nil {
		return types.SleeperUser{}, err
	}

	return *user, nil
}

func (c *SleeperClient) GetLeague(ctx context.Context, leagueID string) (types.SleeperLeague, error) {
	u := fmt.Sprintf("%s/league/%s", baseURL, leagueID)

	req, err := chttp.NewJSONRequest(ctx, http.MethodGet, u, nil)
	if err != nil {
		return types.SleeperLeague{}, err
	}

	res, err := c.httpClient.Do(req)

	league := &types.SleeperLeague{}
	if err := chttp.JSONResponder(res, err, league); err != nil {
		return types.SleeperLeague{}, err
	}

	return *league, nil
}

func (c *SleeperClient) GetUsersInLeague(ctx context.Context, leagueID string) (types.Users, error) {
	u := fmt.Sprintf("%s/league/%s/users", baseURL, leagueID)

	req, err := chttp.NewJSONRequest(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}

	res, err := c.httpClient.Do(req)

	users := types.Users{}
	if err := chttp.JSONResponder(res, err, &users); err != nil {
		return nil, err
	}

	return users, nil
}

func (c *SleeperClient) GetRostersInLeague(ctx context.Context, leagueID string) (types.Rosters, error) {
	u := fmt.Sprintf("%s/league/%s/rosters", baseURL, leagueID)

	req, err := chttp.NewJSONRequest(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}

	res, err := c.httpClient.Do(req)

	rosters := types.Rosters{}
	if err := chttp.JSONResponder(res, err, &rosters); err != nil {
		return nil, err
	}

	return rosters, nil
}

func (c *SleeperClient) GetMatchupsForWeek(ctx context.Context, leagueID string, week int) (types.Matchups, error) {
	u := fmt.Sprintf("%s/league/%s/matchups/%d", baseURL, leagueID, week)

	req, err := chttp.NewJSONRequest(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}

	res, err := c.httpClient.Do(req)

	matchups := types.Matchups{}
	if err := chttp.JSONResponder(res, err, &matchups); err != nil {
		return nil, err
	}

	return matchups, nil
}

func (c *SleeperClient) GetNFLState(ctx context.Context) (types.NFLState, error) {
	u := fmt.Sprintf("%s/state/nfl", baseURL)

	req, err := chttp.NewJSONRequest(ctx, http.MethodGet, u, nil)
	if err != nil {
		return types.NFLState{}, err
	}

	res, err := c.httpClient.Do(req)

	state := &types.NFLState{}
	if err := chttp.JSONResponder(res, err, state); err != nil {
		return types.NFLState{}, err
	}

	return *state, nil
}

func (c *SleeperClient) FetchAllPlayers(ctx context.Context) ([]byte, error) {
	u := fmt.Sprintf("%s/players/nfl", baseURL)

	req, err := chttp.NewJSONRequest(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}

	res, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}

	b, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}

	return b, nil
}

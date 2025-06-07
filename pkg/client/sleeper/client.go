package sleeper

import (
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/sam-maryland/any-given-sunday/pkg/chttp"
)

var (
	baseURL = "https://api.sleeper.app/v1/"
)

type ISleeperClient interface {
	GetUser(ctx context.Context, userID string) (SleeperUser, error)

	GetLeague(ctx context.Context, leagueID string) (SleeperLeague, error)
	GetUsersInLeague(ctx context.Context, leagueID string) (SleeperUsers, error)
	GetRostersInLeague(ctx context.Context, leagueID string) (Rosters, error)

	GetMatchupsForWeek(ctx context.Context, leagueID string, week int) (Matchups, error)

	GetNFLState(ctx context.Context) (NFLState, error)
	FetchAllPlayers(ctx context.Context) ([]byte, error)
}

type SleeperClient struct {
	httpClient *http.Client
}

func NewSleeperClient(c *http.Client) *SleeperClient {
	return &SleeperClient{httpClient: c}
}

func (c *SleeperClient) GetUser(ctx context.Context, userID string) (SleeperUser, error) {
	u := fmt.Sprintf("%s/user/%s", baseURL, userID)

	req, err := chttp.NewJSONRequest(ctx, http.MethodGet, u, nil)
	if err != nil {
		return SleeperUser{}, err
	}

	res, err := c.httpClient.Do(req)

	user := &SleeperUser{}
	if err := chttp.JSONResponder(res, err, user); err != nil {
		return SleeperUser{}, err
	}

	return *user, nil
}

func (c *SleeperClient) GetLeague(ctx context.Context, leagueID string) (SleeperLeague, error) {
	u := fmt.Sprintf("%s/league/%s", baseURL, leagueID)

	req, err := chttp.NewJSONRequest(ctx, http.MethodGet, u, nil)
	if err != nil {
		return SleeperLeague{}, err
	}

	res, err := c.httpClient.Do(req)

	league := &SleeperLeague{}
	if err := chttp.JSONResponder(res, err, league); err != nil {
		return SleeperLeague{}, err
	}

	return *league, nil
}

func (c *SleeperClient) GetUsersInLeague(ctx context.Context, leagueID string) (SleeperUsers, error) {
	u := fmt.Sprintf("%s/league/%s/users", baseURL, leagueID)

	req, err := chttp.NewJSONRequest(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}

	res, err := c.httpClient.Do(req)

	users := SleeperUsers{}
	if err := chttp.JSONResponder(res, err, &users); err != nil {
		return nil, err
	}

	return users, nil
}

func (c *SleeperClient) GetRostersInLeague(ctx context.Context, leagueID string) (Rosters, error) {
	u := fmt.Sprintf("%s/league/%s/rosters", baseURL, leagueID)

	req, err := chttp.NewJSONRequest(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}

	res, err := c.httpClient.Do(req)

	rosters := Rosters{}
	if err := chttp.JSONResponder(res, err, &rosters); err != nil {
		return nil, err
	}

	return rosters, nil
}

func (c *SleeperClient) GetMatchupsForWeek(ctx context.Context, leagueID string, week int) (Matchups, error) {
	u := fmt.Sprintf("%s/league/%s/matchups/%d", baseURL, leagueID, week)

	req, err := chttp.NewJSONRequest(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}

	res, err := c.httpClient.Do(req)

	matchups := Matchups{}
	if err := chttp.JSONResponder(res, err, &matchups); err != nil {
		return nil, err
	}

	return matchups, nil
}

func (c *SleeperClient) GetNFLState(ctx context.Context) (NFLState, error) {
	u := fmt.Sprintf("%s/state/nfl", baseURL)

	req, err := chttp.NewJSONRequest(ctx, http.MethodGet, u, nil)
	if err != nil {
		return NFLState{}, err
	}

	res, err := c.httpClient.Do(req)

	state := &NFLState{}
	if err := chttp.JSONResponder(res, err, state); err != nil {
		return NFLState{}, err
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

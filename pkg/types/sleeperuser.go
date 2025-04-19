package types

import "fmt"

type SleeperUser struct {
	ID          string       `json:"user_id"`
	Username    string       `json:"username"`
	DisplayName string       `json:"display_name"`
	Avatar      string       `json:"avatar"`
	Metadata    UserMetadata `json:"metadata"`
}

type UserMetadata struct {
	TeamName string `json:"team_name"`
}

type SleeperUsers []SleeperUser

func (us SleeperUsers) WithID(id string) SleeperUser {
	for _, u := range us {
		if u.ID == id {
			return u
		}
	}
	return SleeperUser{}
}

func (u SleeperUser) String() {
	fmt.Printf("%s - %s (%s)\n", u.TeamName(), u.DisplayName, u.ID)
}

func (u SleeperUser) TeamName() string {
	if u.Metadata.TeamName == "" {
		return u.DisplayName
	}
	return u.Metadata.TeamName
}

type SleeperUserMap map[string]SleeperUser

package types

import "fmt"

type User struct {
	ID          string       `json:"user_id"`
	Username    string       `json:"username"`
	DisplayName string       `json:"display_name"`
	Avatar      string       `json:"avatar"`
	Metadata    UserMetadata `json:"metadata"`
}

type UserMetadata struct {
	TeamName string `json:"team_name"`
}

type Users []User

func (u User) String() {
	if u.Metadata.TeamName == "" {
		u.Metadata.TeamName = u.DisplayName
	}
	fmt.Printf("%s - %s (%s)\n", u.Metadata.TeamName, u.DisplayName, u.ID)
}

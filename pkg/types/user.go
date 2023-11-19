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

func (us Users) WithID(id string) User {
	for _, u := range us {
		if u.ID == id {
			return u
		}
	}
	return User{}
}

func (u User) String() {
	fmt.Printf("%s - %s (%s)\n", u.TeamName(), u.DisplayName, u.ID)
}

func (u User) TeamName() string {
	if u.Metadata.TeamName == "" {
		return u.DisplayName
	}
	return u.Metadata.TeamName
}

package types

import "any-given-sunday/internal/db"

type User struct {
	ID        string
	Name      string
	DiscordID string
}

func FromDBUser(u db.User) User {
	return User{
		ID:        u.ID,
		Name:      u.Name,
		DiscordID: u.DiscordID,
	}
}

type Users []User

func FromDBUsers(users []db.User) Users {
	var result Users
	for _, u := range users {
		result = append(result, FromDBUser(u))
	}
	return result
}

type UserMap map[string]User

func DBUsersToUserMap(users []db.User) UserMap {
	userMap := make(UserMap)
	for _, u := range users {
		userMap[u.ID] = FromDBUser(u)
	}
	return userMap
}

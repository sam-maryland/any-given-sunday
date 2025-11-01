package domain

type User struct {
	ID        string
	Name      string
	DiscordID string
	Email     string
}

type Users []User

type UserMap map[string]User

// UserMapFromSlice converts a slice of Users to a UserMap indexed by user ID
func UserMapFromSlice(users []User) UserMap {
	userMap := make(UserMap, len(users))
	for _, user := range users {
		userMap[user.ID] = user
	}
	return userMap
}

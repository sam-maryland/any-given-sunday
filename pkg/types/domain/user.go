package domain

type User struct {
	ID        string
	Name      string
	DiscordID string
}

type Users []User

type UserMap map[string]User

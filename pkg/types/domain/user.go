package domain

type User struct {
	ID        string
	Name      string
	DiscordID string
	Email     string
}

type Users []User

type UserMap map[string]User

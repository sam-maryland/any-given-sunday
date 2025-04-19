package config

import (
	"log"
	"os"
)

var cfg *Config

type Config struct {
	Discord
	DBUrl string
}

type Discord struct {
	Token   string
	AppID   string
	GuildID string
}

func InitConfig() *Config {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL environment variable not set")
	}
	return &Config{
		Discord: initDiscordConfig(),
		DBUrl:   dbURL,
	}
}

func initDiscordConfig() Discord {
	dt := os.Getenv("DISCORD_TOKEN")
	if dt == "" {
		log.Fatal("DISCORD_TOKEN environment variable not set")
	}
	aid := os.Getenv("DISCORD_APP_ID")
	if aid == "" {
		log.Fatal("DISCORD_APP_ID environment variable not set")
	}
	gid := os.Getenv("DISCORD_GUILD_ID")
	if gid == "" {
		log.Fatal("DISCORD_GUILD_ID environment variable not set")
	}

	return Discord{
		Token:   dt,
		AppID:   aid,
		GuildID: gid,
	}
}

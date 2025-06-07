-- name: GetCareerStatsByDiscordID :one
SELECT * FROM career_stats WHERE discord_id = $1;

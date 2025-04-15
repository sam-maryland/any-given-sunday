-- name: GetAllCareerStats :many
SELECT * FROM career_stats;

-- name: GetCareerStatsBySleeperUserID :one
SELECT * FROM career_stats WHERE user_id = $1;

-- name: GetCareerStatsByDiscordID :one
SELECT * FROM career_stats WHERE discord_id = $1;

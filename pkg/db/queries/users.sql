-- name: GetUsers :many
SELECT * FROM users;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: InsertUser :exec
INSERT INTO users (id, name, discord_id, onboarding_complete) 
VALUES ($1, $2, $3, $4);

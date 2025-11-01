-- name: GetUsers :many
SELECT * FROM users;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUsersWithEmail :many
SELECT * FROM users WHERE email != '' AND email IS NOT NULL;

-- name: InsertUser :exec
INSERT INTO users (id, name, discord_id, onboarding_complete, email)
VALUES ($1, $2, $3, $4, $5);

-- name: GetUsersWithoutDiscordID :many
-- Get all Sleeper users that haven't been claimed by Discord users yet
SELECT * FROM users 
WHERE discord_id = '' OR discord_id IS NULL
ORDER BY name;

-- name: UpdateUserDiscordID :exec
-- Link a Discord user ID to a Sleeper user account
UPDATE users 
SET discord_id = $2, onboarding_complete = true 
WHERE id = $1 AND (discord_id = '' OR discord_id IS NULL);

-- name: IsUserOnboarded :one
-- Check if a Discord user has already completed onboarding
SELECT EXISTS(
    SELECT 1 FROM users 
    WHERE discord_id = $1 AND onboarding_complete = true
) AS is_onboarded;

-- name: GetUserByDiscordID :one
-- Get user record by Discord ID
SELECT * FROM users WHERE discord_id = $1 LIMIT 1;

-- name: CheckSleeperUserClaimed :one
-- Check if a Sleeper user is already claimed by someone else
SELECT EXISTS(
    SELECT 1 FROM users 
    WHERE id = $1 AND discord_id != '' AND discord_id IS NOT NULL
) AS is_claimed;
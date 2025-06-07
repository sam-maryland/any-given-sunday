package interactor

import (
	"context"
	"fmt"

	"github.com/sam-maryland/any-given-sunday/pkg/db"
	"github.com/sam-maryland/any-given-sunday/pkg/types"
)

type OnboardingInteractor interface {
	GetAvailableSleeperUsers(ctx context.Context) ([]AvailableSleeperUser, error)
	LinkDiscordToSleeperUser(ctx context.Context, discordID, sleeperUserID string) error
	IsUserOnboarded(ctx context.Context, discordID string) (bool, error)
}

type AvailableSleeperUser struct {
	SleeperUserID string
	DisplayName   string
	Username      string
	TeamName      string
	RosterID      int
}

// GetAvailableSleeperUsers retrieves all Sleeper users that haven't been claimed by Discord users yet
func (i *interactor) GetAvailableSleeperUsers(ctx context.Context) ([]AvailableSleeperUser, error) {
	// Get users from DB where discord_id is empty
	users, err := i.DB.GetUsersWithoutDiscordID(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get unclaimed users: %w", err)
	}

	// Get current league to fetch roster information
	currentLeague, err := i.DB.GetLatestLeague(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get current league: %w", err)
	}

	// Get rosters from Sleeper API for team names
	rosters, err := i.SleeperClient.GetRostersInLeague(ctx, currentLeague.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get rosters from Sleeper: %w", err)
	}

	var available []AvailableSleeperUser
	for _, user := range users {
		// Get Sleeper user details
		sleeperUser, err := i.SleeperClient.GetUser(ctx, user.ID)
		if err != nil {
			// Log error but continue with other users
			fmt.Printf("Failed to get Sleeper user %s: %v\n", user.ID, err)
			continue
		}

		// Find the roster owned by this user
		var roster types.Roster
		var found bool
		for _, r := range rosters {
			if r.OwnerID == user.ID {
				roster = r
				found = true
				break
			}
			// Also check co-owners
			for _, coOwner := range r.CoOwners {
				if coOwner == user.ID {
					roster = r
					found = true
					break
				}
			}
			if found {
				break
			}
		}

		// Use team name from Sleeper user metadata, fallback to display name
		teamName := sleeperUser.TeamName()
		if teamName == "" && found {
			// If no team name set, use a generic team identifier
			teamName = fmt.Sprintf("Team %d", roster.ID)
		}

		available = append(available, AvailableSleeperUser{
			SleeperUserID: user.ID,
			DisplayName:   sleeperUser.DisplayName,
			Username:      sleeperUser.Username,
			TeamName:      teamName,
			RosterID:      roster.ID,
		})
	}

	return available, nil
}

// LinkDiscordToSleeperUser attempts to link a Discord user to a Sleeper user account
func (i *interactor) LinkDiscordToSleeperUser(ctx context.Context, discordID, sleeperUserID string) error {
	// First check if the Sleeper user is already claimed
	isClaimed, err := i.DB.CheckSleeperUserClaimed(ctx, sleeperUserID)
	if err != nil {
		return fmt.Errorf("failed to check if Sleeper user is claimed: %w", err)
	}

	if isClaimed {
		return fmt.Errorf("this Sleeper account has already been claimed by another Discord user")
	}

	// Check if Discord user is already linked to another account
	isOnboarded, err := i.DB.IsUserOnboarded(ctx, discordID)
	if err != nil {
		return fmt.Errorf("failed to check onboarding status: %w", err)
	}

	if isOnboarded {
		return fmt.Errorf("this Discord user is already linked to a Sleeper account")
	}

	// Attempt to link the accounts
	err = i.DB.UpdateUserDiscordID(ctx, db.UpdateUserDiscordIDParams{
		ID:        sleeperUserID,
		DiscordID: discordID,
	})
	if err != nil {
		return fmt.Errorf("failed to link Discord user to Sleeper account: %w", err)
	}

	return nil
}

// IsUserOnboarded checks if a Discord user has already completed the onboarding process
func (i *interactor) IsUserOnboarded(ctx context.Context, discordID string) (bool, error) {
	return i.DB.IsUserOnboarded(ctx, discordID)
}
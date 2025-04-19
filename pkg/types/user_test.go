package types

import (
	"any-given-sunday/internal/db"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

func Test_FromDBUser(t *testing.T) {
	user := db.User{
		ID:        uuid.NewString(),
		Name:      uuid.NewString(),
		DiscordID: uuid.NewString(),
	}

	expected := User{
		ID:        user.ID,
		Name:      user.Name,
		DiscordID: user.DiscordID,
	}

	assert.Equal(t, expected, FromDBUser(user))
}

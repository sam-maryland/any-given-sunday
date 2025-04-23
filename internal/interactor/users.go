package interactor

import (
	"context"

	"github.com/sam-maryland/any-given-sunday/pkg/types"
)

type UsersInteractor interface {
	GetUsers(ctx context.Context) (types.UserMap, error)
}

func (i *interactor) GetUsers(ctx context.Context) (types.UserMap, error) {
	users, err := i.DB.GetUsers(ctx)
	if err != nil {
		return nil, err
	}
	return types.DBUsersToUserMap(users), nil
}

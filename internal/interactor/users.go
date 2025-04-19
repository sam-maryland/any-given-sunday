package interactor

import (
	"any-given-sunday/pkg/types"
	"context"
)

type UsersInteractor interface {
	GetUsers(ctx context.Context) (types.UserMap, error)
}

func (i *interactor) GetUsers(ctx context.Context) (types.UserMap, error) {
	users, err := i.Queries.GetUsers(ctx)
	if err != nil {
		return nil, err
	}
	return types.DBUsersToUserMap(users), nil
}

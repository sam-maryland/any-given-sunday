package interactor

import (
	"context"

	"github.com/sam-maryland/any-given-sunday/pkg/types/converters"
	"github.com/sam-maryland/any-given-sunday/pkg/types/domain"
)

type UsersInteractor interface {
	GetUsers(ctx context.Context) (domain.UserMap, error)
}

func (i *interactor) GetUsers(ctx context.Context) (domain.UserMap, error) {
	users, err := i.DB.GetUsers(ctx)
	if err != nil {
		return nil, err
	}
	return converters.UsersToUserMap(users), nil
}

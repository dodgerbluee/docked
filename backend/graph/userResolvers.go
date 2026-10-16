package graph

import (
	"context"
	"fmt"
	"strconv"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/db"
)

// userStatsFor loads per-user resource counts, gating on ownership:
// users may only view their own counts, instance admins may view any.
// Lives outside schema.resolvers.go so gqlgen regenerations leave it alone.
func (r *userResolver) userStatsFor(ctx context.Context, obj *model.User) (*db.UserStats, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	target, err := strconv.ParseInt(obj.ID, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid user id")
	}
	if uid != target {
		if _, err := requireAdmin(ctx, r.DB); err != nil {
			return nil, err
		}
	}
	return db.CountUserStats(ctx, r.DB, target)
}

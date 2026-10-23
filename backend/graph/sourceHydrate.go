package graph

import (
	"context"
	"database/sql"
	"strconv"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/db"
)

// Relation fields on history and execution rows carry only an identity from
// the parent query (a runner id, an intent id). Projecting that identity
// straight into the GraphQL object answers the target's non-null fields with
// Go zero values: every history row's source claimed its runner was disabled
// since the epoch, and a nested `type` came back as the empty string, which is
// not a member of SourceType. The source field resolvers load the real row
// instead, and these two helpers do that loading.

// hydrateRunner loads the complete runner behind a seeded source reference.
// A nil result means the host is gone (deleted runner, or inventory migrated
// from the retired Portainer sources), which the nullable field reports as
// null rather than as a runner that is switched off.
func hydrateRunner(ctx context.Context, database *sql.DB, idStr *string) (*model.Runner, error) {
	if idStr == nil || *idStr == "" {
		return nil, nil
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, err := strconv.ParseInt(*idStr, 10, 64)
	if err != nil {
		return nil, nil
	}
	row, err := db.GetRunnerByID(ctx, database, id, uid)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, nil
	}
	return runnerToModel(row), nil
}

// hydrateIntent loads the policy behind an execution. The denormalized name on
// the execution row is not enough to answer the rest of Intent, so a deleted
// policy surfaces as null rather than as a disabled intent with an empty
// schedule type.
func hydrateIntent(ctx context.Context, database *sql.DB, idStr *string) (*model.Intent, error) {
	if idStr == nil || *idStr == "" {
		return nil, nil
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, err := strconv.ParseInt(*idStr, 10, 64)
	if err != nil {
		return nil, nil
	}
	row, err := db.GetIntentByID(ctx, database, id, uid)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, nil
	}
	return intentToModel(row), nil
}

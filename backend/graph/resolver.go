package graph

import (
	"database/sql"

	"github.com/dockedapp/backend/internal/config"
	"github.com/dockedapp/backend/internal/events"
	"github.com/dockedapp/backend/internal/imagesync"
	"github.com/dockedapp/backend/internal/intents"
)

// Resolver holds shared dependencies injected into all resolvers.
type Resolver struct {
	DB   *sql.DB
	Cfg  *config.Config
	Hub  *events.Hub
	Sync *imagesync.Service

	// Intents is the shared scheduled/immediate intent evaluator wired by
	// api.NewServer; resolvers borrow its executor for manual triggers.
	Intents *intents.Evaluator
}

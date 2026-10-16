package graph

import (
	"database/sql"

	"github.com/dockedapp/backend/internal/config"
	"github.com/dockedapp/backend/internal/events"
)

// Resolver holds shared dependencies injected into all resolvers.
type Resolver struct {
	DB  *sql.DB
	Cfg *config.Config
	Hub *events.Hub
}

package graph

import (
	"database/sql"

	"github.com/dockedapp/backend/internal/config"
)

// Resolver holds shared dependencies injected into all resolvers.
type Resolver struct {
	DB   *sql.DB
	Cfg  *config.Config
}

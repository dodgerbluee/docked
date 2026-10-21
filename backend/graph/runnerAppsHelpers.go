// Runner apps field: fetches the runner agent's /apps endpoint (same endpoint
// the app-version-scan job consumes) and maps the payload onto the GraphQL
// RunnerApp shape. Unreachable runners yield an empty list — the field
// contract is a non-null list and a dead runner is not a query error.
package graph

import (
	"context"
	"log/slog"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/runner"
)

func fetchRunnerApps(ctx context.Context, rr db.RunnerRow) []*model.RunnerApp {
	data, err := runner.FetchJSON(ctx, rr, "/apps", nil)
	if err != nil {
		slog.Debug("runner apps fetch failed", "runnerId", rr.ID, "runnerName", rr.Name, "error", err)
		return []*model.RunnerApp{}
	}
	raw, _ := data["apps"].([]any)
	out := make([]*model.RunnerApp, 0, len(raw))
	for _, item := range raw {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name, _ := m["name"].(string)
		if name == "" {
			continue
		}
		app := &model.RunnerApp{
			Name:              name,
			Description:       optJSONString(m["description"]),
			CurrentVersion:    optJSONString(m["currentVersion"]),
			VersionCommand:    optJSONString(m["versionCommand"]),
			VersionSource:     versionSourceLabel(m["versionSource"]),
			SystemUpdateCheck: optJSONBool(m["systemUpdateCheck"]),
			SystemUpdates:     optJSONInt(m["systemUpdates"]),
		}
		if ops, ok := m["operations"].([]any); ok {
			for _, o := range ops {
				om, ok := o.(map[string]any)
				if !ok {
					continue
				}
				oname, _ := om["name"].(string)
				if oname == "" {
					continue
				}
				app.Operations = append(app.Operations, &model.RunnerOperation{
					Name:        oname,
					Description: optJSONString(om["description"]),
				})
			}
		}
		out = append(out, app)
	}
	return out
}

func optJSONString(v any) *string {
	s, ok := v.(string)
	if !ok || s == "" {
		return nil
	}
	return &s
}

func optJSONBool(v any) *bool {
	b, ok := v.(bool)
	if !ok {
		return nil
	}
	return &b
}

func optJSONInt(v any) *int {
	f, ok := v.(float64)
	if !ok {
		return nil
	}
	n := int(f)
	return &n
}

// versionSourceLabel flattens the runner's versionSource (either a bare
// string or a {type, repo, ...} object) into the schema's String shape.
func versionSourceLabel(v any) *string {
	switch t := v.(type) {
	case string:
		return optJSONString(t)
	case map[string]any:
		return optJSONString(t["type"])
	default:
		return nil
	}
}

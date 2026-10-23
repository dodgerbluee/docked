package handlers

// Config-export endpoints ported from Node's authController.js (phase 7b):
// GET /user/export-config (own config) and GET /auth/export-users (all
// users, instance-admin only). The serialized file format is a contract:
// the bootstrap/import flow (createUserWithConfig) reads these files back,
// so key names, casing, and even Node's camelCase-read quirks are
// reproduced verbatim.

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"sort"
	"time"

	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/db"
)

// isoNow renders timestamps the way Node's Date.prototype.toISOString()
// does, so export files are byte-compatible between stacks.
func isoNow() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func nullStrVal(s sql.NullString) any {
	if !s.Valid {
		return nil
	}
	return s.String
}

// nullStrOrEmptyNull is the `value || null` pattern used by the all-users
// export: empty strings collapse to null.
func nullStrOrEmptyNull(s sql.NullString) any {
	if !s.Valid || s.String == "" {
		return nil
	}
	return s.String
}

func orStr(p *string, fallback string) string {
	if p == nil || *p == "" {
		return fallback
	}
	return *p
}

// portainerExportRow maps a source instance for both export endpoints
// (the key name is a legacy file-format contract).
func portainerExportRow(r db.SourceInstanceFull) map[string]any {
	return map[string]any{
		"id":            r.ID,
		"name":          r.Name,
		"url":           r.URL,
		"auth_type":     r.AuthType,
		"display_order": r.DisplayOrder,
		"ip_address":    nullStrVal(r.IPAddress),
		"created_at":    nullStrVal(r.CreatedAt),
		"updated_at":    nullStrVal(r.UpdatedAt),
	}
}

// batchConfigMap mirrors Node's getBatchConfig(): rows keyed by job_type
// plus defaults for the two legacy job types.
func batchConfigMap(rows []db.BatchConfigRow) map[string]any {
	configs := map[string]any{}
	for _, r := range rows {
		configs[r.JobType] = map[string]any{
			"enabled":         r.Enabled == 1,
			"intervalMinutes": r.IntervalMinutes,
			"updatedAt":       r.UpdatedAt,
		}
	}
	for _, jobType := range []string{"docker-hub-pull", "tracked-apps-check"} {
		if _, ok := configs[jobType]; !ok {
			configs[jobType] = map[string]any{
				"enabled": false, "intervalMinutes": 60, "updatedAt": nil,
			}
		}
	}
	return configs
}

func generalSettingsMap(ctx context.Context, database *sql.DB, userID int64) (map[string]any, error) {
	colorScheme, err := db.GetSetting(ctx, database, "color_scheme", userID)
	if err != nil {
		return nil, err
	}
	logLevel, err := db.GetSystemSetting(ctx, database, "log_level")
	if err != nil {
		return nil, err
	}
	toggles, err := db.GetSetting(ctx, database, "refreshing_toggles_enabled", userID)
	if err != nil {
		return nil, err
	}
	batchRows, err := db.GetBatchConfigs(ctx, database, userID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"colorScheme":              orStr(colorScheme, "system"),
		"logLevel":                 orStr(logLevel, "info"),
		"refreshingTogglesEnabled": toggles != nil && *toggles == "true",
		"batchConfig":              batchConfigMap(batchRows),
	}, nil
}

// ExportUserConfig handles GET /user/export-config (Node's exportUserConfig).
func ExportUserConfig(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := auth.UserID(r.Context())
		if !ok {
			runnerFail(w, http.StatusUnauthorized, "Authentication required")
			return
		}
		user, err := db.GetUserByID(r.Context(), database, userID)
		if err != nil {
			internalFail(w)
			return
		}
		if user == nil {
			runnerFail(w, http.StatusNotFound, "User not found")
			return
		}

		instances, err := db.GetAllSourceInstancesFull(r.Context(), database, user.ID)
		if err != nil {
			internalFail(w)
			return
		}
		webhooks, err := db.GetDiscordWebhooks(r.Context(), database, user.ID)
		if err != nil {
			internalFail(w)
			return
		}
		apps, err := db.GetAllTrackedApps(r.Context(), database, user.ID)
		if err != nil {
			internalFail(w)
			return
		}
		general, err := generalSettingsMap(r.Context(), database, user.ID)
		if err != nil {
			internalFail(w)
			return
		}

		portainerOut := []any{}
		for _, inst := range instances {
			portainerOut = append(portainerOut, portainerExportRow(inst))
		}
		// Snake-case reads: this endpoint serializes the real column values.
		webhooksOut := []any{}
		for _, wh := range webhooks {
			webhooksOut = append(webhooksOut, map[string]any{
				"id":           wh.ID,
				"server_name":  nullStrVal(wh.ServerName),
				"channel_name": nullStrVal(wh.ChannelName),
				"avatar_url":   nullStrVal(wh.AvatarURL),
				"guild_id":     nullStrVal(wh.GuildID),
				"channel_id":   nullStrVal(wh.ChannelID),
				"enabled":      wh.Enabled,
				"name":         nullStrOrEmptyNull(wh.Name),
				"created_at":   wh.CreatedAt,
				"updated_at":   wh.UpdatedAt,
			})
		}
		appsOut := []any{}
		for _, app := range apps {
			appsOut = append(appsOut, map[string]any{
				"id":                           app.ID,
				"name":                         app.Name,
				"image_name":                   nullStrVal(app.ImageName),
				"github_repo":                  nullStrVal(app.GithubRepo),
				"source_type":                  app.SourceType,
				"current_version":              nullStrVal(app.CurrentVersion),
				"current_digest":               nullStrVal(app.CurrentDigest),
				"latest_version":               nullStrVal(app.LatestVersion),
				"latest_digest":                nullStrVal(app.LatestDigest),
				"has_update":                   app.HasUpdate == 1,
				"current_version_publish_date": nullStrVal(app.CurrentVersionPublishDate),
				"latest_version_publish_date":  nullStrVal(app.LatestVersionPublishDate),
				"last_checked":                 nullStrVal(app.LastChecked),
				"created_at":                   app.CreatedAt,
				"updated_at":                   app.UpdatedAt,
			})
		}

		runnerOK(w, http.StatusOK, map[string]any{
			"data": map[string]any{
				"exportDate": isoNow(),
				"user": map[string]any{
					"username":       user.Username,
					"role":           user.Role,
					"instance_admin": user.InstanceAdmin == 1,
					"created_at":     user.CreatedAt,
					"updated_at":     user.UpdatedAt,
				},
				"portainerInstances": portainerOut,
				"discordWebhooks":    webhooksOut,
				"trackedApps":        appsOut,
				"generalSettings":    general,
			},
		})
	}
}

// ExportUsers handles GET /auth/export-users (Node's exportUsersEndpoint).
//
// Fidelity notes: Node reads camelCase properties off snake-case webhook
// rows, so those metadata keys are always null and the created_at /
// updated_at keys are omitted entirely (JSON.stringify drops undefined).
// Node's dockerHubCredentials read crashed on a removed repository export
// (latent 500); this port fixes it against docker_hub_credentials while
// keeping the masked-token shape.
func ExportUsers(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := auth.UserID(r.Context())
		if !ok {
			runnerFail(w, http.StatusUnauthorized, "Authentication required")
			return
		}
		caller, err := db.GetUserByID(r.Context(), database, userID)
		if err != nil {
			internalFail(w)
			return
		}
		if caller == nil || caller.InstanceAdmin != 1 {
			runnerFail(w, http.StatusForbidden, "Forbidden")
			return
		}

		allUsers, err := db.GetAllUsers(r.Context(), database)
		if err != nil {
			internalFail(w)
			return
		}
		// Node's getAllUsers orders by created_at ASC.
		sort.SliceStable(allUsers, func(i, j int) bool {
			if allUsers[i].CreatedAt != allUsers[j].CreatedAt {
				return allUsers[i].CreatedAt < allUsers[j].CreatedAt
			}
			return allUsers[i].ID < allUsers[j].ID
		})

		usersOut := []any{}
		for _, u := range allUsers {
			entry, err := exportUserEntry(r.Context(), database, u)
			if err != nil {
				slog.Error("export-users: per-user export failed",
					"user", u.Username, "error", err.Error())
				internalFail(w)
				return
			}
			usersOut = append(usersOut, entry)
		}

		runnerOK(w, http.StatusOK, map[string]any{
			"data": map[string]any{
				"exportDate": isoNow(),
				"users":      usersOut,
			},
		})
	}
}

func exportUserEntry(ctx context.Context, database *sql.DB, u db.UserRow) (map[string]any, error) {
	instances, err := db.GetAllSourceInstancesFull(ctx, database, u.ID)
	if err != nil {
		return nil, err
	}
	creds, err := db.GetRegistryCredentials(ctx, database, u.ID)
	if err != nil {
		// The legacy table may predate migrations; treat as unconfigured.
		slog.Warn("export-users: registry credentials lookup failed", "error", err.Error())
		creds = nil
	}
	webhooks, err := db.GetDiscordWebhooks(ctx, database, u.ID)
	if err != nil {
		return nil, err
	}
	apps, err := db.GetAllTrackedApps(ctx, database, u.ID)
	if err != nil {
		return nil, err
	}
	general, err := generalSettingsMap(ctx, database, u.ID)
	if err != nil {
		return nil, err
	}

	portainerOut := []any{}
	for _, inst := range instances {
		portainerOut = append(portainerOut, portainerExportRow(inst))
	}

	var dockerHub any
	if creds != nil {
		token := any(nil)
		if creds.Token.Valid && creds.Token.String != "" {
			token = "***configured***"
		}
		dockerHub = map[string]any{
			"username": nullStrOrEmptyNull(creds.Username),
			"token":    token,
		}
	}

	// Node reads camelCase keys off snake-case rows: every metadata value
	// is null and the timestamp keys are absent from the JSON.
	webhooksOut := []any{}
	for _, wh := range webhooks {
		webhooksOut = append(webhooksOut, map[string]any{
			"id":           wh.ID,
			"server_name":  nil,
			"channel_name": nil,
			"avatar_url":   nil,
			"guild_id":     nil,
			"channel_id":   nil,
			"enabled":      wh.Enabled,
			"name":         nullStrOrEmptyNull(wh.Name),
		})
	}

	appsOut := []any{}
	for _, app := range apps {
		appsOut = append(appsOut, map[string]any{
			"id":                           app.ID,
			"name":                         app.Name,
			"image_name":                   nullStrVal(app.ImageName),
			"github_repo":                  nullStrOrEmptyNull(app.GithubRepo),
			"source_type":                  orStr2(app.SourceType, "docker"),
			"gitlab_token":                 nullStrOrEmptyNull(app.GitlabToken),
			"current_version":              nullStrOrEmptyNull(app.CurrentVersion),
			"current_digest":               nullStrOrEmptyNull(app.CurrentDigest),
			"latest_version":               nullStrOrEmptyNull(app.LatestVersion),
			"latest_digest":                nullStrOrEmptyNull(app.LatestDigest),
			"has_update":                   app.HasUpdate == 1,
			"current_version_publish_date": nullStrOrEmptyNull(app.CurrentVersionPublishDate),
			"latest_version_publish_date":  nullStrOrEmptyNull(app.LatestVersionPublishDate),
			"last_checked":                 nullStrOrEmptyNull(app.LastChecked),
			"created_at":                   app.CreatedAt,
			"updated_at":                   app.UpdatedAt,
		})
	}

	email := any(nil)
	if u.Email.Valid && u.Email.String != "" {
		email = u.Email.String
	}
	role := "Administrator"
	if u.Role != "" {
		role = u.Role
	}

	return map[string]any{
		"user": map[string]any{
			"username":       u.Username,
			"email":          email,
			"role":           role,
			"instance_admin": u.InstanceAdmin == 1,
			"created_at":     u.CreatedAt,
			"updated_at":     u.UpdatedAt,
		},
		"portainerInstances":   portainerOut,
		"dockerHubCredentials": dockerHub,
		"discordWebhooks":      webhooksOut,
		"trackedApps":          appsOut,
		"generalSettings":      general,
	}, nil
}

func orStr2(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

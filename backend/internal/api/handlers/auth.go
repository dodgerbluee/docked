package handlers

// REST auth routes ported from Node's authController.js (phase 7a): login,
// token verification, logout, and the bootstrap/import user-creation
// endpoint. Node keeps the edge rate limiters and forwards these routes
// through utils/goRunnerProxy.js, so the response envelopes must match
// Node exactly.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/oauth"
	"github.com/golang-jwt/jwt/v5"
)

// decodeJSONObject decodes a JSON body into a generic map so the handlers
// can mirror Node's loose destructuring. An empty body decodes to an empty
// map (express.json leaves req.body = {}); a malformed body gets a generic
// 400 envelope.
func decodeJSONObject(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	body := map[string]any{}
	if err := dec.Decode(&body); err != nil {
		if errors.Is(err, io.EOF) {
			return body, true
		}
		runnerFail(w, http.StatusBadRequest, "Invalid request body")
		return nil, false
	}
	return body, true
}

// jsTruthy mirrors JavaScript truthiness for decoded JSON values.
func jsTruthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case string:
		return t != ""
	case float64:
		return t != 0 && !math.IsNaN(t)
	}
	return true
}

// asString renders a decoded JSON value the way a JS template literal would
// interpolate it (numbers without a trailing .0, everything else via its
// string form; nil becomes "").
func asString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		if t {
			return "true"
		}
		return "false"
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	}
	return fmt.Sprint(v)
}

// nullStr maps a decoded JSON value to a nullable TEXT parameter: absent /
// null become nil, strings pass through, other scalars are stringified.
func nullStr(v any) *string {
	if v == nil {
		return nil
	}
	s := asString(v)
	return &s
}

// jsLen counts UTF-16 code units, matching String.prototype.length for the
// username/password length gates.
func jsLen(s string) int {
	return len(utf16.Encode([]rune(s)))
}

// bearerLike reproduces Node's `authorization?.replace("Bearer ", "")`:
// only the first occurrence is stripped, and a header without the prefix
// is passed through untouched (so it fails JWT validation rather than
// reading as "no token").
func bearerLike(r *http.Request) string {
	return strings.Replace(r.Header.Get("Authorization"), "Bearer ", "", 1)
}

func internalFail(w http.ResponseWriter) {
	slog.Error("auth handler: internal error")
	runnerFail(w, http.StatusInternalServerError, "Internal server error")
}

// Login handles POST /auth/login (Node's login).
func Login(database *sql.DB, registry *oauth.Registry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// oauth_allow_local_login is a server-side door, not just a client
		// form hint: refuse password login here too when SSO-only mode is on.
		if registry != nil {
			registry.EnsureFresh(r.Context())
			if registry.Enabled() {
				allow := registry.AllowLocalLoginDefault()
				if v, err := db.GetSystemSetting(r.Context(), database, "oauth_allow_local_login"); err == nil && v != nil {
					allow = *v != "false"
				}
				if !allow {
					runnerFail(w, http.StatusForbidden,
						"Local login is disabled. Please sign in with single sign-on.")
					return
				}
			}
		}

		body, ok := decodeJSONObject(w, r)
		if !ok {
			return
		}

		var missing []string
		for _, f := range []string{"username", "password"} {
			if body[f] == nil {
				missing = append(missing, f)
			}
		}
		if len(missing) > 0 {
			writeRunnerJSON(w, http.StatusBadRequest, map[string]any{
				"success":       false,
				"error":         "Missing required fields: " + strings.Join(missing, ", "),
				"missingFields": missing,
			})
			return
		}

		username := asString(body["username"])
		password := asString(body["password"])

		user, err := db.GetUserByUsername(r.Context(), database, username)
		if err != nil {
			internalFail(w)
			return
		}
		if user == nil {
			runnerFail(w, http.StatusUnauthorized, "Invalid username or password")
			return
		}

		// OAuth-only accounts (no password set) get a helpful SSO message.
		if !nullStrTruthy(user.PasswordHash) && nullStrTruthy(user.OAuthProvider) {
			runnerFail(w, http.StatusUnauthorized,
				"This account uses SSO. Please sign in with "+user.OAuthProvider.String+".")
			return
		}

		if !auth.CheckPassword(user.PasswordHash.String, password) {
			runnerFail(w, http.StatusUnauthorized, "Invalid username or password")
			return
		}

		token, refreshToken, err := auth.GenerateTokens(user.ID, user.Username, user.Role, user.TokenVersion)
		if err != nil {
			slog.Error("login: token generation failed", "error", err.Error())
			internalFail(w)
			return
		}

		// Non-blocking: a last_login failure must not fail the login.
		if err := db.UpdateLastLogin(r.Context(), database, username); err != nil {
			slog.Warn("login: last_login update failed", "error", err.Error())
		}

		runnerOK(w, http.StatusOK, map[string]any{
			"token":         token,
			"refreshToken":  refreshToken,
			"username":      user.Username,
			"role":          user.Role,
			"instanceAdmin": user.InstanceAdmin == 1,
		})
	}
}

func nullStrTruthy(s sql.NullString) bool {
	return s.Valid && s.String != ""
}

// VerifyToken handles GET /auth/verify (Node's verifyToken). Like Node's
// verifyJWT this is signature-only: revoked tokens still verify.
func VerifyToken(database *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearerLike(r)
		if token == "" {
			runnerFail(w, http.StatusUnauthorized, "No token provided")
			return
		}

		userID, tokenVersion, _, err := auth.ValidateTokenWithVersion(token, secret)
		if err != nil {
			msg := "Invalid token"
			if errors.Is(err, jwt.ErrTokenExpired) {
				msg = "Token expired"
			}
			runnerFail(w, http.StatusUnauthorized, msg)
			return
		}

		user, err := db.GetUserByID(r.Context(), database, userID)
		if err != nil {
			internalFail(w)
			return
		}
		if user == nil {
			runnerFail(w, http.StatusUnauthorized, "User not found")
			return
		}
		// Same session-eviction checks as StrictMiddleware: a token minted
		// before a password change carries a stale version, and logged-out
		// tokens live in revoked_tokens. Verify must not accept either, or
		// it becomes a revocation oracle bypass for the client's boot check.
		if tokenVersion != user.TokenVersion {
			runnerFail(w, http.StatusUnauthorized, "Invalid token")
			return
		}
		if revoked, err := db.IsTokenRevoked(r.Context(), database, token); err != nil || revoked {
			runnerFail(w, http.StatusUnauthorized, "Invalid token")
			return
		}

		runnerOK(w, http.StatusOK, map[string]any{
			"username":      user.Username,
			"role":          user.Role,
			"instanceAdmin": user.InstanceAdmin == 1,
		})
	}
}

// Logout handles POST /auth/logout (Node's logout): hash-revoke the access
// token and, when provided, the refresh token. Invalid tokens are ignored.
func Logout(database *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, ok := decodeJSONObject(w, r)
		if !ok {
			return
		}

		if token := bearerLike(r); token != "" {
			if userID, exp, err := auth.ValidateTokenClaims(token, secret); err == nil {
				if err := db.RevokeToken(r.Context(), database, token, userID, exp); err != nil {
					slog.Error("logout: access token revoke failed", "error", err.Error())
					runnerFail(w, http.StatusInternalServerError, "Failed to log out")
					return
				}
			}
		}

		if rt := asString(body["refreshToken"]); rt != "" {
			if claims, err := auth.VerifyRefreshToken(rt); err == nil {
				exp := int64(0)
				if claims.ExpiresAt != nil {
					exp = claims.ExpiresAt.Unix()
				}
				if err := db.RevokeToken(r.Context(), database, rt, claims.UserID, exp); err != nil {
					slog.Error("logout: refresh token revoke failed", "error", err.Error())
					runnerFail(w, http.StatusInternalServerError, "Failed to log out")
					return
				}
			}
		}

		runnerOK(w, http.StatusOK, map[string]any{"message": "Logged out"})
	}
}

// resolveInstanceAdminCaller resolves the request's Bearer token (if any)
// to an instance-admin user. Node verified signatures only, but the Go
// stack enforces revocation + token versioning everywhere else; the import
// endpoint creates users, so a stolen-but-revoked (or password-evicted)
// admin token must not keep authorizing it.
func resolveInstanceAdminCaller(ctx context.Context, database *sql.DB, secret string, r *http.Request) *db.UserRow {
	header := r.Header.Get("Authorization")
	var token string
	if strings.HasPrefix(header, "Bearer ") {
		token = header[len("Bearer "):]
	}
	if token == "" {
		return nil
	}
	userID, tokenVersion, _, err := auth.ValidateTokenWithVersion(token, secret)
	if err != nil {
		return nil
	}
	if revoked, err := db.IsTokenRevoked(ctx, database, token); err != nil || revoked {
		return nil
	}
	user, err := db.GetUserByID(ctx, database, userID)
	if err != nil || user == nil {
		return nil
	}
	if user.InstanceAdmin != 1 || tokenVersion != user.TokenVersion {
		return nil
	}
	return user
}

// CreateUserWithConfig handles POST /auth/create-user-with-config
// (Node's createUserWithConfig): the public bootstrap/import endpoint that
// creates one user plus their configuration in a single call.
func CreateUserWithConfig(database *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, ok := decodeJSONObject(w, r)
		if !ok {
			return
		}

		userData, _ := body["userData"].(map[string]any)
		if userData == nil || !jsTruthy(userData["username"]) || !jsTruthy(userData["password"]) {
			runnerFail(w, http.StatusBadRequest, "User data with username and password is required")
			return
		}

		username := asString(userData["username"])
		password := asString(userData["password"])
		email := asString(userData["email"])
		role := asString(userData["role"])
		instanceAdmin := jsTruthy(userData["instanceAdmin"])

		if jsLen(username) < 3 {
			runnerFail(w, http.StatusBadRequest, `Username "`+username+`" must be at least 3 characters long`)
			return
		}
		if jsLen(password) < 8 {
			runnerFail(w, http.StatusBadRequest, `Password for "`+username+`" must be at least 8 characters long`)
			return
		}
		if strings.TrimSpace(email) != "" && !isValidEmail(strings.TrimSpace(email)) {
			runnerFail(w, http.StatusBadRequest, `Invalid email format for "`+username+`"`)
			return
		}

		existing, err := db.GetUserByUsername(r.Context(), database, username)
		if err != nil {
			internalFail(w)
			return
		}
		if existing != nil {
			runnerOK(w, http.StatusOK, map[string]any{
				"skipped": true,
				"message": `User "` + username + `" already exists`,
			})
			return
		}

		// Account-creation gate: once an instance admin exists, member
		// creation requires an authenticated instance-admin caller; while
		// none exists the bootstrap window is open.
		if !instanceAdmin {
			caller := resolveInstanceAdminCaller(r.Context(), database, secret, r)
			if caller == nil {
				exists, err := db.InstanceAdminExists(r.Context(), database)
				if err != nil {
					internalFail(w)
					return
				}
				if exists {
					runnerFail(w, http.StatusForbidden, "Creating users requires an authenticated instance admin")
					return
				}
			}
		}

		// Privilege-grant gate: instance-admin creation is only honored with
		// the pending verification token minted via generateInstanceAdminToken.
		verificationToken := asString(body["verificationToken"])
		if instanceAdmin {
			consumed := false
			if verificationToken != "" {
				var err error
				consumed, err = db.ConsumePendingToken(r.Context(), database, "instance_admin", username, verificationToken)
				if err != nil {
					internalFail(w)
					return
				}
			}
			if !consumed {
				runnerFail(w, http.StatusForbidden, "A valid verification token is required to create an instance admin")
				return
			}
		}

		hash, err := auth.HashPassword(password)
		if err != nil {
			slog.Error("create-user-with-config: password hash failed", "error", err.Error())
			internalFail(w)
			return
		}
		var emailArg *string
		if email != "" { // Node: email || null
			emailArg = &email
		}
		roleArg := role
		if roleArg == "" { // Node: role || "Administrator"
			roleArg = "Administrator"
		}
		ia := 0
		if instanceAdmin {
			ia = 1
		}
		if _, err := db.CreateUserFull(r.Context(), database, username, hash, emailArg, roleArg, ia); err != nil {
			slog.Error("create-user-with-config: user insert failed", "error", err.Error())
			internalFail(w)
			return
		}

		if instanceAdmin {
			if err := db.UpdateVerificationToken(r.Context(), database, username, verificationToken); err != nil {
				slog.Error("create-user-with-config: verification token store failed", "error", err.Error())
			}
		}

		user, err := db.GetUserByUsername(r.Context(), database, username)
		if err != nil {
			internalFail(w)
			return
		}
		if user == nil {
			runnerFail(w, http.StatusInternalServerError, "Failed to retrieve created user")
			return
		}

		// Clear any leftover pending token (the grant path consumed it; this
		// covers non-admin imports).
		if err := db.DeletePendingToken(r.Context(), database, "instance_admin", username); err != nil {
			slog.Warn("create-user-with-config: pending token cleanup failed", "error", err.Error())
		}

		results := map[string]any{
			"portainerInstances":   []any{},
			"dockerHubCredentials": nil,
			"discordWebhooks":      []any{},
			"trackedApps":          []any{},
			"errors":               []any{},
		}

		configData, _ := body["configData"].(map[string]any)
		credentials, _ := body["credentials"].(map[string]any)
		skipped := skippedSteps(body["skippedSteps"])

		if configData != nil && credentials != nil {
			if instances, ok := configData["portainerInstances"].([]any); ok &&
				!skipped["portainer"] && jsTruthy(credentials["portainerInstances"]) {
				importPortainerInstancesByIndex(r.Context(), database, instances,
					credArray(credentials["portainerInstances"]), user, results)
			}

			if jsTruthy(configData["dockerHubCredentials"]) && jsTruthy(credentials["dockerHub"]) &&
				!skipped["dockerhub"] {
				appendImportError(results,
					"Docker Hub credential import is no longer supported. Use 'docker login' instead.")
			}

			if webhooks, ok := configData["discordWebhooks"].([]any); ok &&
				!skipped["discord"] && jsTruthy(credentials["discordWebhooks"]) {
				importDiscordWebhooksByIndex(r.Context(), database, webhooks,
					credArray(credentials["discordWebhooks"]), user, results)
			}
		}

		if configData != nil {
			if apps, ok := configData["trackedApps"].([]any); ok {
				importTrackedApps(r.Context(), database, apps, user, results)
			}
			if gs := configData["generalSettings"]; gs != nil {
				if gsMap, ok := gs.(map[string]any); ok {
					if err := importGeneralSettings(r.Context(), database, gsMap, user, results); err != nil {
						appendImportError(results, "General settings: "+err.Error())
					}
				} else {
					results["generalSettings"] = map[string]any{"imported": true}
				}
			}
		}

		runnerOK(w, http.StatusOK, map[string]any{
			"message": `User "` + username + `" created successfully`,
			"results": results,
		})
	}
}

func credArray(v any) []any {
	arr, _ := v.([]any)
	return arr
}

func skippedSteps(v any) map[string]bool {
	out := map[string]bool{}
	if arr, ok := v.([]any); ok {
		for _, item := range arr {
			out[asString(item)] = true
		}
	}
	return out
}

func appendImportError(results map[string]any, msg string) {
	results["errors"] = append(results["errors"].([]any), msg)
}

func importList(results map[string]any, key string, entry any) {
	results[key] = append(results[key].([]any), entry)
}

var (
	emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	ipv4Re     = regexp.MustCompile(`^\d+\.\d+\.\d+\.\d+$`)
	ipv6ishRe  = regexp.MustCompile(`^\[?[0-9a-fA-F:]+]?$`)
)

// isValidEmail mirrors Node's ReDoS-safe email pattern plus the 254-char cap.
func isValidEmail(email string) bool {
	if len(email) > 254 {
		return false
	}
	return emailRegex.MatchString(email)
}

// resolveUrlToIp mirrors Node's dnsResolver: literal hostnames pass through,
// otherwise the first IPv4 answer wins; failures resolve to null.
func resolveUrlToIp(ctx context.Context, urlString string) *string {
	u, err := url.Parse(urlString)
	if err != nil || u.Hostname() == "" {
		return nil
	}
	host := u.Hostname()
	if ipv4Re.MatchString(host) || ipv6ishRe.MatchString(host) {
		return &host
	}
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip4", host)
	if err != nil || len(ips) == 0 {
		return nil
	}
	first := ips[0].String()
	return &first
}

func importPortainerInstancesByIndex(ctx context.Context, database *sql.DB, instances []any,
	credsArr []any, user *db.UserRow, results map[string]any) {

	for i, raw := range instances {
		instance, _ := raw.(map[string]any)
		var creds any
		if i < len(credsArr) {
			creds = credsArr[i]
		}
		name := asString(instance["name"])
		if creds == nil {
			appendImportError(results, `Portainer instance "`+name+`": Missing credentials`)
			continue
		}
		credMap, _ := creds.(map[string]any)

		authType := asString(instance["auth_type"])
		if authType == "" {
			authType = "apikey"
		}
		var u, p, ak *string
		if asString(instance["auth_type"]) == "password" {
			// Node: creds.username || "" / creds.password || ""
			u = strPtr("")
			if jsTruthy(credMap["username"]) {
				u = strPtr(asString(credMap["username"]))
			}
			p = strPtr("")
			if jsTruthy(credMap["password"]) {
				p = strPtr(asString(credMap["password"]))
			}
		} else {
			// Node: creds.apiKey || null
			if jsTruthy(credMap["apiKey"]) {
				s := asString(credMap["apiKey"])
				ak = &s
			}
		}

		ip := resolveUrlToIp(ctx, asString(instance["url"]))
		id, err := db.CreateSourceInstance(ctx, database, user.ID, name,
			asString(instance["url"]), u, p, ak, authType, ip)
		if err != nil {
			appendImportError(results, `Portainer instance "`+name+`": `+err.Error())
			continue
		}
		importList(results, "portainerInstances", map[string]any{"id": id, "name": instance["name"]})
	}
}

func strPtr(s string) *string { return &s }

func importDiscordWebhooksByIndex(ctx context.Context, database *sql.DB, webhooks []any,
	credsArr []any, user *db.UserRow, results map[string]any) {

	for i, raw := range webhooks {
		webhook, _ := raw.(map[string]any)
		var creds any
		if i < len(credsArr) {
			creds = credsArr[i]
		}
		credMap, _ := creds.(map[string]any)
		label := asString(webhook["server_name"])
		if label == "" {
			label = asString(webhook["id"])
		}
		if credMap == nil || !jsTruthy(credMap["webhookUrl"]) {
			appendImportError(results, `Discord webhook "`+label+`": Missing webhook URL`)
			continue
		}

		enabled := true
		if v, present := webhook["enabled"]; present {
			enabled = jsTruthy(v)
		}
		name := asString(webhook["name"])
		if name == "" {
			name = "Docked"
		}

		id, err := db.CreateDiscordWebhookFull(ctx, database, user.ID, asString(credMap["webhookUrl"]),
			nullStr(webhook["server_name"]), nullStr(webhook["channel_name"]), strPtr(name),
			nullStr(webhook["avatar_url"]), nullStr(webhook["guild_id"]), nullStr(webhook["channel_id"]), enabled)
		if err != nil {
			appendImportError(results, `Discord webhook "`+label+`": `+err.Error())
			continue
		}
		importList(results, "discordWebhooks", map[string]any{"id": id, "serverName": webhook["server_name"]})
	}
}

// trackedUpdateCols are the version-metadata columns buildTrackedAppUpdateData
// copies when present in the imported config.
var trackedUpdateCols = []string{
	"current_version", "current_digest", "latest_version", "latest_digest",
	"has_update", "current_version_publish_date", "latest_version_publish_date", "last_checked",
}

func importTrackedApps(ctx context.Context, database *sql.DB, apps []any, user *db.UserRow, results map[string]any) {
	for _, raw := range apps {
		image, _ := raw.(map[string]any)
		name := asString(image["name"])

		sourceType := asString(image["source_type"])
		if sourceType == "" {
			sourceType = "docker"
		}
		var gitlabToken *string
		if s := asString(image["gitlab_token"]); s != "" {
			gitlabToken = &s
		}

		id, err := db.CreateTrackedApp(ctx, database, user.ID, name,
			nullStr(image["image_name"]), nullStr(image["github_repo"]), sourceType, gitlabToken, nil)
		if err != nil {
			appendImportError(results, `Tracked image "`+name+`": `+err.Error())
			continue
		}

		sets := map[string]any{}
		for _, col := range trackedUpdateCols {
			v, present := image[col]
			if !present {
				continue
			}
			if col == "has_update" {
				if b, ok := v.(bool); ok {
					v = 0
					if b {
						v = 1
					}
				}
			}
			sets[col] = v
		}
		if len(sets) > 0 {
			// The row was created moments ago by this same import, so reload
			// it as the baseline the guarded update must still match.
			created, err := db.GetTrackedAppByID(ctx, database, id, user.ID)
			if err != nil {
				appendImportError(results, `Tracked image "`+name+`": `+err.Error())
				continue
			}
			if created == nil {
				appendImportError(results, `Tracked image "`+name+`": created row not found`)
				continue
			}
			if _, err := db.UpdateTrackedAppFields(ctx, database, id, user.ID, sets,
				created.ObservedSnapshot()); err != nil {
				appendImportError(results, `Tracked image "`+name+`": `+err.Error())
				continue
			}
		}
		importList(results, "trackedApps", map[string]any{"id": id, "name": image["name"]})
	}
}

func importGeneralSettings(ctx context.Context, database *sql.DB, gs map[string]any,
	user *db.UserRow, results map[string]any) error {

	if cs := asString(gs["colorScheme"]); cs != "" {
		if err := db.SetSetting(ctx, database, "color_scheme", user.ID, cs); err != nil {
			return err
		}
	}
	if ll := asString(gs["logLevel"]); ll != "" {
		if err := db.SetSystemSetting(ctx, database, "log_level", ll); err != nil {
			return err
		}
	}
	if v, present := gs["refreshingTogglesEnabled"]; present {
		if err := db.SetSetting(ctx, database, "refreshing_toggles_enabled", user.ID, asString(v)); err != nil {
			return err
		}
	}
	if batchConfig, ok := gs["batchConfig"].(map[string]any); ok && batchConfig != nil {
		for jobType, raw := range batchConfig {
			cfg, _ := raw.(map[string]any)
			enabled := jsTruthy(cfg["enabled"])
			interval := 0
			if f, ok := cfg["intervalMinutes"].(float64); ok {
				interval = int(f)
			}
			if err := db.UpdateBatchConfig(ctx, database, user.ID, jobType, enabled, interval); err != nil {
				return err
			}
		}
	}
	results["generalSettings"] = map[string]any{"imported": true}
	return nil
}

package graph

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/db"
)

func requireUser(ctx context.Context) (int64, error) {
	uid := auth.UserIDFromContext(ctx)
	if uid == 0 {
		return 0, fmt.Errorf("authentication required")
	}
	return uid, nil
}
func requireAdmin(ctx context.Context) (int64, error) {
	uid := auth.UserIDFromContext(ctx)
	if uid == 0 {
		return 0, fmt.Errorf("authentication required")
	}
	return uid, nil
}
func userRowToModel(u *db.UserRow) *model.User {
	if u == nil {
		return nil
	}
	return &model.User{
		ID:              strconv.FormatInt(u.ID, 10),
		Username:        u.Username,
		Role:            model.Role(u.Role),
		PasswordChanged: u.PasswordChanged == 1,
		CreatedAt:       parseTime(u.CreatedAt),
		UpdatedAt:       parseTime(u.UpdatedAt),
	}
}
func sourceInstanceToModel(s *db.SourceInstanceRow) *model.SourceInstance {
	if s == nil {
		return nil
	}
	return &model.SourceInstance{
		ID:           strconv.FormatInt(s.ID, 10),
		Name:         s.Name,
		URL:          s.URL,
		Type:         model.SourceTypePortainer,
		AuthType:     model.AuthType(s.AuthType),
		IPAddress:    nullStrPtr(s.IPAddress),
		DisplayOrder: s.DisplayOrder,
		CreatedAt:    parseTime(s.CreatedAt),
		UpdatedAt:    parseTime(s.UpdatedAt),
		HasAPIKey:    s.APIKey.Valid && s.APIKey.String != "",
		HasPassword:  s.Password.Valid && s.Password.String != "",
	}
}
func runnerToModel(r *db.RunnerRow) *model.Runner {
	if r == nil {
		return nil
	}
	return &model.Runner{
		ID:            strconv.FormatInt(r.ID, 10),
		Name:          r.Name,
		URL:           r.URL,
		Type:          model.SourceTypeRunner,
		Enabled:       r.Enabled,
		Version:       nullStrPtr(r.Version),
		DockerEnabled: r.DockerEnabled.Valid && r.DockerEnabled.Int64 == 1,
		LastHeartbeat: nullTimePtr(r.LastSeen),
		HealthStatus:  nullStrPtr(r.DockerStatus),
		CreatedAt:     parseTime(r.CreatedAt),
		UpdatedAt:     parseTime(r.UpdatedAt),
		HasAPIKey:     r.APIKey != "",
	}
}
func trackedAppToModel(t *db.TrackedAppRow) *model.TrackedApp {
	if t == nil {
		return nil
	}
	return &model.TrackedApp{
		ID:                        strconv.FormatInt(t.ID, 10),
		Name:                      t.Name,
		ImageName:                 nullStrPtr(t.ImageName),
		GithubRepo:                nullStrPtr(t.GithubRepo),
		SourceType:                model.TrackedAppSourceType(t.SourceType),
		CurrentVersion:            nullStrPtr(t.CurrentVersion),
		CurrentDigest:             nullStrPtr(t.CurrentDigest),
		LatestVersion:             nullStrPtr(t.LatestVersion),
		LatestDigest:              nullStrPtr(t.LatestDigest),
		HasUpdate:                 t.HasUpdate == 1,
		CurrentVersionPublishDate: nullTimePtr(t.CurrentVersionPublishDate),
		LatestVersionPublishDate:  nullTimePtr(t.LatestVersionPublishDate),
		LastChecked:               nullTimePtr(t.LastChecked),
		CreatedAt:                 parseTime(t.CreatedAt),
		UpdatedAt:                 parseTime(t.UpdatedAt),
	}
}
func intentToModel(i *db.IntentRow) *model.Intent {
	if i == nil {
		return nil
	}
	return &model.Intent{
		ID:                 strconv.FormatInt(i.ID, 10),
		Name:               i.Name,
		Description:        nullStrPtr(i.Description),
		Enabled:            i.Enabled == 1,
		MatchContainers:    db.UnmarshalStringArr(i.MatchContainers),
		MatchImages:        db.UnmarshalStringArr(i.MatchImages),
		MatchSources:       db.UnmarshalStringArr(i.MatchSources),
		MatchStacks:        db.UnmarshalStringArr(i.MatchStacks),
		MatchRegistries:    db.UnmarshalStringArr(i.MatchRegistries),
		ExcludeContainers:  db.UnmarshalStringArr(i.ExcludeContainers),
		ExcludeImages:      db.UnmarshalStringArr(i.ExcludeImages),
		ExcludeStacks:      db.UnmarshalStringArr(i.ExcludeStacks),
		ExcludeRegistries:  db.UnmarshalStringArr(i.ExcludeRegistries),
		ScheduleType:       model.IntentScheduleType(i.ScheduleType),
		ScheduleCron:       nullStrPtr(i.ScheduleCron),
		MaxConcurrent:      i.MaxConcurrent,
		DryRun:             i.DryRun == 1,
		SequentialDelaySec: i.SequentialDelaySec,
		LastEvaluatedAt:    nullTimePtr(i.LastEvaluatedAt),
		CreatedAt:          parseTime(i.CreatedAt),
		UpdatedAt:          parseTime(i.UpdatedAt),
	}
}
func batchConfigToModel(b *db.BatchConfigRow) *model.BatchConfig {
	if b == nil {
		return nil
	}
	return &model.BatchConfig{
		ID:              strconv.FormatInt(b.ID, 10),
		JobType:         model.BatchJobType(b.JobType),
		Enabled:         b.Enabled == 1,
		IntervalMinutes: b.IntervalMinutes,
		CreatedAt:       parseTime(b.CreatedAt),
		UpdatedAt:       parseTime(b.UpdatedAt),
	}
}
func batchRunToModel(b *db.BatchRunRow) *model.BatchRun {
	if b == nil {
		return nil
	}
	return &model.BatchRun{
		ID:                strconv.FormatInt(b.ID, 10),
		Status:            model.BatchRunStatus(b.Status),
		JobType:           model.BatchJobType(b.JobType),
		QueuedAt:          parseTime(b.StartedAt),
		StartedAt:         nullTimePtr(sql.NullString{String: b.StartedAt, Valid: b.StartedAt != ""}),
		CompletedAt:       nullTimePtr(b.CompletedAt),
		DurationMs:        nullInt64Ptr(b.DurationMs),
		ContainersChecked: b.ContainersChecked,
		ContainersUpdated: b.ContainersUpdated,
		ErrorMessage:      nullStrPtr(b.ErrorMessage),
		Logs:              nullStrPtr(b.Logs),
		IsManual:          b.IsManual == 1,
	}
}
func upgradeRecordToModel(u *db.UpgradeHistoryRow) *model.UpgradeRecord {
	if u == nil {
		return nil
	}
	rec := &model.UpgradeRecord{
		ID:                strconv.FormatInt(u.ID, 10),
		DockerContainerID: u.ContainerID,
		ContainerName:     u.ContainerName,
		EndpointID:        nullStrPtr(u.EndpointID),
		SourceURL:         nullStrPtr(u.SourceURL),
		OldImage:          u.OldImage,
		NewImage:          u.NewImage,
		OldDigest:         nullStrPtr(u.OldDigest),
		NewDigest:         nullStrPtr(u.NewDigest),
		OldVersion:        nullStrPtr(u.OldVersion),
		NewVersion:        nullStrPtr(u.NewVersion),
		ImageRepo:         nullStrPtr(u.ImageRepo),
		Registry:          nullStrPtr(u.Registry),
		Namespace:         nullStrPtr(u.Namespace),
		Repository:        nullStrPtr(u.Repository),
		Status:            model.UpgradeStatus(u.Status),
		ErrorMessage:      nullStrPtr(u.ErrorMessage),
		UpgradeDurationMs: nullInt64ToIntPtr(u.UpgradeDuration),
		IntentID:          nullInt64StrPtr(u.IntentID),
		CreatedAt:         parseTime(u.CreatedAt),
	}
	if u.RunnerID.Valid {
		rec.Source = &model.Runner{
			ID:   strconv.FormatInt(u.RunnerID.Int64, 10),
			Name: nullStrDefault(u.RunnerName),
		}
	} else if u.SourceInstanceID.Valid {
		rec.Source = &model.SourceInstance{
			ID:   strconv.FormatInt(u.SourceInstanceID.Int64, 10),
			Name: nullStrDefault(u.SourceName),
		}
	}
	return rec
}
func discordWebhookToModel(d *db.DiscordWebhookRow) *model.DiscordWebhook {
	if d == nil {
		return nil
	}
	return &model.DiscordWebhook{
		ID:          strconv.FormatInt(d.ID, 10),
		MaskedURL:   maskURL(d.WebhookURL),
		ServerName:  nullStrPtr(d.ServerName),
		ChannelName: nullStrPtr(d.ChannelName),
		Enabled:     d.Enabled == 1,
		AvatarURL:   nullStrPtr(d.AvatarURL),
		GuildID:     nullStrPtr(d.GuildID),
		ChannelID:   nullStrPtr(d.ChannelID),
		CreatedAt:   parseTime(d.CreatedAt),
		UpdatedAt:   parseTime(d.UpdatedAt),
	}
}
func containerRowToModel(c *db.ContainerRow) *model.Container {
	if c == nil {
		return nil
	}
	state := model.ContainerStateUnknown
	if c.State.Valid {
		switch c.State.String {
		case "running":
			state = model.ContainerStateRunning
		case "exited":
			state = model.ContainerStateExited
		case "restarting":
			state = model.ContainerStateRestarting
		}
	}

	return &model.Container{
		ID:                strconv.FormatInt(c.ID, 10),
		DockerContainerID: c.ContainerID,
		Name:              c.ContainerName,
		ImageName:         nullStrDefault(c.ImageName),
		ImageRepo:         nullStrDefault(c.ImageRepo),
		Status:            nullStrPtr(c.Status),
		State:             state,
		StackName:         nullStrPtr(c.StackName),
		EndpointID:        nullInt64StrPtr(c.EndpointID),
		CurrentDigest:     nullStrPtr(c.CurrentDigest),
		UsesNetworkMode:   c.UsesNetworkMode,
		ProvidesNetwork:   c.ProvidesNetwork,
		LastSeen:          parseTime(nullStrDefault(c.LastSeen)),
		CreatedAt:         parseTime(nullStrDefault(c.CreatedAt)),
		UpdatedAt:         parseTime(nullStrDefault(c.CreatedAt)),
		Source:            containerSourceFromRow(c),
		ImageInfo:         imageInfoFromRow(c),
	}
}
func imageInfoFromRow(c *db.ContainerRow) *model.ImageVersionInfo {
	// Only return imageInfo if we have registry_image_versions data
	if !c.LatestTag.Valid && !c.Provider.Valid && !c.ImageTag.Valid {
		return nil
	}
	repo := nullStrDefault(c.ImageRepo)
	registry := model.RegistryDockerHub
	if c.Provider.Valid {
		switch strings.ToLower(c.Provider.String) {
		case "ghcr":
			registry = model.RegistryGhcr
		case "quay":
			registry = model.RegistryQuay
		case "lscr":
			registry = model.RegistryOther
		}
	}
	namespace, repository := parseRepoParts(repo)
	hasUpdate := false
	if c.LatestDigest.Valid && c.CurrentDigest.Valid {
		hasUpdate = c.LatestDigest.String != c.CurrentDigest.String
	} else if c.LatestTag.Valid && c.ImageTag.Valid {
		hasUpdate = c.LatestTag.String != c.ImageTag.String
	}
	info := &model.ImageVersionInfo{
		Registry:   registry,
		Namespace:  namespace,
		Repository: repository,
		HasUpdate:  hasUpdate,
	}
	if c.ImageTag.Valid {
		info.CurrentTag = &c.ImageTag.String
	}
	if c.CurrentDigest.Valid {
		info.CurrentDigest = &c.CurrentDigest.String
	}
	if c.LatestTag.Valid {
		info.LatestTag = &c.LatestTag.String
	}
	if c.LatestVersion.Valid {
		info.LatestVersion = &c.LatestVersion.String
	}
	if c.LatestDigest.Valid {
		info.LatestDigest = &c.LatestDigest.String
	}
	if c.LatestPublishDate.Valid {
		t := parseTime(c.LatestPublishDate.String)
		info.LatestPublishDate = &t
	}
	if c.LastChecked.Valid {
		info.LastChecked = parseTime(c.LastChecked.String)
	}
	return info
}
func parseRepoParts(repo string) (*string, string) {
	// Strip registry prefix if present
	base := repo
	if idx := strings.Index(base, "/"); idx != -1 && (strings.Contains(base[:idx], ".") || strings.Contains(base[:idx], ":")) {
		base = base[idx+1:]
	}
	// Strip tag/digest
	if idx := strings.IndexAny(base, ":@"); idx != -1 {
		base = base[:idx]
	}
	parts := strings.SplitN(base, "/", 2)
	if len(parts) == 2 {
		ns := parts[0]
		return &ns, parts[1]
	}
	return nil, base
}
func containerSourceFromRow(c *db.ContainerRow) model.ContainerSource {
	if c.RunnerID.Valid {
		return &model.Runner{
			ID:   strconv.FormatInt(c.RunnerID.Int64, 10),
			Name: nullStrDefault(c.RunnerName),
			URL:  nullStrDefault(c.RunnerURL),
			Type: model.SourceTypeRunner,
		}
	}
	if c.SourceInstanceID.Valid {
		return &model.SourceInstance{
			ID:   strconv.FormatInt(c.SourceInstanceID.Int64, 10),
			Name: nullStrDefault(c.SourceName),
			URL:  nullStrDefault(c.SourceURL),
			Type: model.SourceTypePortainer,
		}
	}
	return nil
}
func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, _ := time.Parse("2006-01-02 15:04:05", s)
	if t.IsZero() {
		t, _ = time.Parse(time.RFC3339, s)
	}
	return t
}
func nullStrPtr(s sql.NullString) *string {
	if !s.Valid {
		return nil
	}
	return &s.String
}
func nullStrDefault(s sql.NullString) string {
	if !s.Valid {
		return ""
	}
	return s.String
}
func nullInt64StrPtr(s sql.NullInt64) *string {
	if !s.Valid {
		return nil
	}
	str := strconv.FormatInt(s.Int64, 10)
	return &str
}
func nullInt64Default(s sql.NullInt64) string {
	if !s.Valid {
		return ""
	}
	return strconv.FormatInt(s.Int64, 10)
}
func nullInt64Ptr(s sql.NullInt64) *int {
	if !s.Valid {
		return nil
	}
	v := int(s.Int64)
	return &v
}
func nullInt64ToIntPtr(s sql.NullInt64) *int {
	if !s.Valid {
		return nil
	}
	v := int(s.Int64)
	return &v
}
func nullTimePtr(s sql.NullString) *time.Time {
	if !s.Valid || s.String == "" {
		return nil
	}
	t := parseTime(s.String)
	if t.IsZero() {
		return nil
	}
	return &t
}
func strPtr(s string) *string { return &s }

// pageArgs parses the standard first/after pagination arguments into a
// limit/offset pair, using defaultLimit when first is not supplied.
func pageArgs(first *int, after *string, defaultLimit int) (limit, offset int) {
	limit = defaultLimit
	if first != nil && *first > 0 {
		limit = *first
	}
	if after != nil && *after != "" {
		offset, _ = strconv.Atoi(*after)
	}
	return limit, offset
}

// paginateContainers applies first/after slicing to an in-memory container
// slice (used by relation resolvers that filter containers in Go).
func paginateContainers(items []*model.Container, first *int, after *string) *model.ContainerConnection {
	limit, offset := pageArgs(first, after, 100)
	total := len(items)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	page := items[offset:end]
	return &model.ContainerConnection{
		Items:      page,
		TotalCount: total,
		PageInfo:   buildPageInfo(len(page), total, limit, offset),
	}
}

func buildPageInfo(returned, total, limit, offset int) *model.PageInfo {
	return &model.PageInfo{
		HasNextPage:     offset+returned < total,
		HasPreviousPage: offset > 0,
		StartCursor:     strPtr(strconv.Itoa(offset)),
		EndCursor:       strPtr(strconv.Itoa(offset + returned)),
	}
}
func maskURL(url string) string {
	if len(url) <= 10 {
		return "***"
	}
	return url[:20] + "..."
}
func joinStr(parts []string, sep string) string {
	result := ""
	for i, p := range parts {
		if i > 0 {
			result += sep
		}
		result += p
	}
	return result
}
func httpPostJSON(url string, payload any, bearerToken string) (int, []byte, error) {
	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if bearerToken != "" {
		req.Header.Set("Authorization", "Bearer "+bearerToken)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, data, nil
}
func httpGet(url string) (int, []byte, error) {
	resp, err := http.Get(url)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, data, nil
}
func httpGetWithAuth(url, username, password string) (int, []byte, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(username+":"+password)))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, data, nil
}
func runnerPost(baseURL, apiKey, path string, payload any) error {
	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", baseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("runner returned %d", resp.StatusCode)
	}
	return nil
}
func runnerDelete(baseURL, apiKey, path string) error {
	req, err := http.NewRequest("DELETE", baseURL+path, nil)
	if err != nil {
		return err
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("runner returned %d", resp.StatusCode)
	}
	return nil
}
func portainerPullAll(src *db.SourceInstanceRow) error {
	// Get Portainer JWT token
	authPayload := map[string]string{"Username": "", "Password": ""}
	if src.APIKey.Valid && src.APIKey.String != "" {
		// API key auth - use directly
		return runnerPost(src.URL, src.APIKey.String, "/api/docker/images/create?fromImage=portainer&tag=latest", nil)
	}
	if src.Password.Valid && src.Password.String != "" {
		authPayload["Username"] = "admin"
		authPayload["Password"] = src.Password.String
	}
	status, body, err := httpPostJSON(src.URL+"/api/auth", authPayload, "")
	if err != nil || status != 200 {
		return fmt.Errorf("portainer auth failed: %d", status)
	}
	var tokenResp struct {
		JWT string `json:"jwt"`
	}
	json.Unmarshal(body, &tokenResp)
	return runnerPost(src.URL, tokenResp.JWT, "/api/docker/images/create?fromImage=portainer&tag=latest", nil)
}
func checkRegistryForImage(imageName string) (string, string) {
	// Parse image name to get repo and tag
	parts := strings.Split(imageName, ":")
	repo := parts[0]
	tag := "latest"
	if len(parts) > 1 {
		tag = parts[1]
	}

	// Determine registry
	var url string
	if strings.Contains(repo, "ghcr.io") || strings.Contains(repo, "ghcr.") {
		url = fmt.Sprintf("https://ghcr.io/v2/%s/manifests/%s", repo, tag)
	} else if strings.Contains(repo, "quay.io") {
		url = fmt.Sprintf("https://quay.io/v2/%s/manifests/%s", repo, tag)
	} else {
		// Docker Hub
		hubRepo := repo
		if !strings.Contains(hubRepo, "/") {
			hubRepo = "library/" + hubRepo
		}
		url = fmt.Sprintf("https://hub.docker.com/v2/repositories/%s/tags/%s", hubRepo, tag)
	}

	status, body, err := httpGet(url)
	if err != nil || status != 200 {
		return "", ""
	}

	var result struct {
		Name   string `json:"name"`
		Digest string `json:"digest"`
	}
	json.Unmarshal(body, &result)
	if result.Digest != "" {
		return tag, result.Digest
	}
	return tag, ""
}
func getDataDir() string {
	if d := os.Getenv("DATA_DIR"); d != "" {
		return d
	}
	return "./data"
}
func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
func repoTokenToModel(t *db.RepositoryTokenRow) *model.RepositoryAccessToken {
	if t == nil {
		return nil
	}
	masked := t.AccessToken
	if len(masked) > 8 {
		masked = masked[:4] + "..." + masked[len(masked)-4:]
	} else {
		masked = "***"
	}
	return &model.RepositoryAccessToken{
		ID:          strconv.FormatInt(t.ID, 10),
		Provider:    t.Provider,
		MaskedToken: masked,
		CreatedAt:   parseTime(t.CreatedAt),
		UpdatedAt:   parseTime(t.UpdatedAt),
	}
}

package graph

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/db"
)

// jsLen returns the length of s in UTF-16 code units, which is exactly what
// JavaScript's String.length counts. Validation rules ported from Node must
// measure the same thing, or astral-plane characters (emoji) diverge: four
// emoji are 8 UTF-16 units but only 4 runes.
func jsLen(s string) int {
	return len(utf16.Encode([]rune(s)))
}

// readFromOffset returns the bytes of a file after the given offset and the
// file's current size. When the file is smaller than the offset (rotation),
// it returns empty content and the new size.
func readFromOffset(path string, offset int64) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return "", 0, err
	}
	if offset >= st.Size() {
		return "", st.Size(), nil
	}
	buf := make([]byte, st.Size()-offset)
	if _, err := f.ReadAt(buf, offset); err != nil && err != io.EOF {
		return "", 0, err
	}
	return string(buf), st.Size(), nil
}

// tailFileLines returns the last maxLines lines of a file (reading backwards
// in chunks so huge log files are not loaded whole) plus the file size.
func tailFileLines(path string, maxLines int) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return "", 0, err
	}
	size := st.Size()
	const chunkSize = 64 * 1024
	var buf []byte
	pos := size
	for pos > 0 && strings.Count(string(buf), "\n") <= maxLines {
		n := int64(chunkSize)
		if n > pos {
			n = pos
		}
		pos -= n
		chunk := make([]byte, n)
		if _, err := f.ReadAt(chunk, pos); err != nil && err != io.EOF {
			return "", 0, err
		}
		buf = append(chunk, buf...)
	}
	lines := strings.Split(strings.TrimRight(string(buf), "\n"), "\n")
	if len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
	}
	return strings.Join(lines, "\n"), size, nil
}

// forwardSubscription bridges a hub channel to a gqlgen subscription
// output channel. It terminates (and runs cleanup) when the subscription
// context is cancelled, so hub subscribers are released on disconnect.
func forwardSubscription[T any](ctx context.Context, in <-chan T, cleanup func()) <-chan *T {
	out := make(chan *T, 1)
	go func() {
		defer close(out)
		defer cleanup()
		for {
			select {
			case <-ctx.Done():
				return
			case v := <-in:
				val := v
				select {
				case out <- &val:
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	return out
}

// publishBatchRun re-reads a batch run and fans it out to batchJobProgress
// subscribers (best-effort).
func (r *mutationResolver) publishBatchRun(ctx context.Context, uid, batchID int64) {
	if r.Hub == nil {
		return
	}
	run, err := db.GetBatchRunByID(ctx, r.DB, batchID, uid)
	if err != nil || run == nil {
		return
	}
	r.Hub.PublishBatchJob(uid, *batchRunToModel(run))
}

// publishIntentExecution re-reads an execution row and fans it out to
// intentExecutionProgress subscribers (best-effort).
func (r *mutationResolver) publishIntentExecution(ctx context.Context, uid, execID int64) {
	if r.Hub == nil {
		return
	}
	row, err := db.GetIntentExecutionByID(ctx, r.DB, execID, uid)
	if err != nil || row == nil {
		return
	}
	r.Hub.PublishIntentExecution(uid, *intentExecutionToModel(*row))
}

// publishUpgradePhase emits an UpgradeProgressEvent for Go-initiated
// upgrades (best-effort).
func (r *mutationResolver) publishUpgradePhase(uid int64, opID string, container *db.ContainerRow, phase model.UpgradePhase, message string) {
	if r.Hub == nil || container == nil {
		return
	}
	srcType, srcName := model.SourceTypeRunner, nullStrDefault(container.RunnerName)
	if !container.RunnerID.Valid {
		srcType = model.SourceTypePortainer
		srcName = nullStrDefault(container.SourceName)
	}
	msg := message
	progress := 100
	r.Hub.PublishUpgradeProgress(uid, model.UpgradeProgressEvent{
		OperationID:       opID,
		DockerContainerID: container.ContainerID,
		ContainerName:     container.ContainerName,
		SourceType:        srcType,
		SourceName:        srcName,
		Phase:             phase,
		Message:           &msg,
		Progress:          &progress,
	})
}

func requireUser(ctx context.Context) (int64, error) {
	uid := auth.UserIDFromContext(ctx)
	if uid == 0 {
		return 0, fmt.Errorf("authentication required")
	}
	return uid, nil
}

func registrationCodesEqual(input, stored string) bool {
	normalize := func(s string) string {
		return strings.ToUpper(strings.ReplaceAll(s, "-", ""))
	}
	return normalize(input) == normalize(stored)
}

// parseIntCursor decodes a relay-style numeric cursor. Anything unparseable
// (garbage, negative, empty) collapses to 0: a negative offset would panic
// the slice expression rows[offset:end] in the paginated resolvers.
func parseIntCursor(after *string) int {
	if after == nil {
		return 0
	}
	n, err := strconv.Atoi(*after)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

func containerTargetKey(containerID string, runnerID, sourceInstanceID *int64) string {
	if runnerID != nil {
		return "runner:" + strconv.FormatInt(*runnerID, 10) + ":" + containerID
	}
	if sourceInstanceID != nil {
		return "portainer:" + strconv.FormatInt(*sourceInstanceID, 10) + ":" + containerID
	}
	return "unknown:" + containerID
}

func claimIdempotency(ctx context.Context, database *sql.DB, userID int64, operationType string, key *string) error {
	claimed, err := db.ClaimIdempotencyKey(ctx, database, userID, operationType, key)
	if err != nil {
		return fmt.Errorf("claim idempotency key: %w", err)
	}
	if !claimed {
		return fmt.Errorf("duplicate idempotency key")
	}
	return nil
}

// requireAdmin returns the caller's user id only if that user is an INSTANCE
// administrator (instance_admin=1). This deliberately matches the Node backend,
// which gates privileged endpoints on req.user.instanceAdmin (see
// server/controllers/authController.js) and assigns the "Administrator" ROLE to
// every user it creates. Role alone is therefore NOT a privilege signal here:
// only instance_admin=1 is.
func requireAdmin(ctx context.Context, database *sql.DB) (int64, error) {
	uid := auth.UserIDFromContext(ctx)
	if uid == 0 {
		return 0, fmt.Errorf("authentication required")
	}
	u, err := db.GetUserByID(ctx, database, uid)
	if err != nil {
		return 0, err
	}
	if u == nil {
		return 0, fmt.Errorf("authentication required")
	}
	if u.InstanceAdmin != 1 {
		return 0, fmt.Errorf("insufficient privileges: instance administrator required")
	}
	return uid, nil
}

// defaultBlockedPatterns is the fallback container blocklist shipped with the
// app (mirrors server/constants/blocklistDefaults.js).
var defaultBlockedPatterns = []string{"portainer", "docked", "nginx-proxy-manager"}

// enumConst normalizes a raw DB enum-ish string (e.g. "docker-hub-pull",
// "Administrator", "dry_run") into the GraphQL enum's UPPER_SNAKE form so the
// value is always a valid member of its enum.
func enumConst(s string) string {
	return strings.ToUpper(strings.NewReplacer("-", "_", " ", "_").Replace(s))
}

// dbEnumValue is the inverse of enumConst: it maps a GraphQL enum member
// (UPPER_SNAKE) back to the lowercase/hyphenated form the Node backend and the
// shared SQLite DB use ("DOCKER_HUB_PULL" -> "docker-hub-pull",
// "SCHEDULED" -> "scheduled", "APIKEY" -> "apikey"). Writing the raw enum
// member would persist values Node's consumers never match — e.g.
// intentEvaluator.js filters on schedule_type === "scheduled", so a stored
// "SCHEDULED" intent is silently skipped by the scheduler.
func dbEnumValue(s string) string {
	return strings.ToLower(strings.ReplaceAll(s, "_", "-"))
}

// batchRunToOperation projects a persisted batch_runs row onto the ephemeral
// Operation type so operation(id) can report progress for batch jobs, which
// are the only operations with a backing table.
func batchRunToOperation(run *db.BatchRunRow) *model.Operation {
	op := &model.Operation{
		ID:       "batch-" + strconv.FormatInt(run.ID, 10),
		Type:     model.OperationTypeBatchUpgrade,
		Status:   model.OperationStatus(enumConst(run.Status)),
		QueuedAt: parseTime(run.StartedAt),
	}
	if st := parseTime(run.StartedAt); !st.IsZero() {
		op.StartedAt = &st
	}
	if run.CompletedAt.Valid {
		if ct := parseTime(run.CompletedAt.String); !ct.IsZero() {
			op.CompletedAt = &ct
		}
	}
	if run.ErrorMessage.Valid {
		op.Message = strPtr(run.ErrorMessage.String)
	}
	return op
}
func userRowToModel(u *db.UserRow) *model.User {
	if u == nil {
		return nil
	}
	m := &model.User{
		ID:              strconv.FormatInt(u.ID, 10),
		Username:        u.Username,
		Role:            model.Role(enumConst(u.Role)),
		PasswordChanged: u.PasswordChanged == 1,
		InstanceAdmin:   u.InstanceAdmin == 1,
		Email:           nullStrPtr(u.Email),
		LastLogin:       nullTimePtr(u.LastLogin),
		CreatedAt:       parseTime(u.CreatedAt),
		UpdatedAt:       parseTime(u.UpdatedAt),
	}
	// Match Node's avatar semantics: the current avatar is the file
	// DATA_DIR/avatars/<uid>/avatar.jpg, served at /api/avatars.
	if avatarExists(u.ID) {
		m.AvatarURL = strPtr("/api/avatars")
	}
	return m
}

// avatarExists reports whether the user's current avatar file is present,
// using the same on-disk layout the Node server writes.
func avatarExists(userID int64) bool {
	path := fmt.Sprintf("%s/avatars/%d/avatar.jpg", getDataDir(), userID)
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// parseIDPtr converts an optional GraphQL ID string to an int64 pointer.
// Empty or invalid IDs yield nil (no constraint).
func parseIDPtr(s *string) *int64 {
	if s == nil || *s == "" {
		return nil
	}
	v, err := strconv.ParseInt(*s, 10, 64)
	if err != nil {
		return nil
	}
	return &v
}

// filterContainerRows applies ContainerFilterInput semantics in memory:
// search/imageName are case-insensitive substrings, state/stackName are
// case-insensitive exact matches, hasUpdate uses the same computed check as
// the imageInfo field, and the ID filters are exact.
func filterContainerRows(rows []db.ContainerRow, f *model.ContainerFilterInput) []db.ContainerRow {
	if f == nil {
		return rows
	}
	var out []db.ContainerRow
	for _, row := range rows {
		if f.Search != nil && *f.Search != "" {
			q := strings.ToLower(*f.Search)
			if !strings.Contains(strings.ToLower(row.ContainerName), q) &&
				!strings.Contains(strings.ToLower(nullStrDefault(row.ImageName)), q) {
				continue
			}
		}
		if f.State != nil && !strings.EqualFold(nullStrDefault(row.State), dbEnumValue(string(*f.State))) {
			continue
		}
		if f.StackName != nil && *f.StackName != "" && !strings.EqualFold(nullStrDefault(row.StackName), *f.StackName) {
			continue
		}
		if f.ImageName != nil && *f.ImageName != "" &&
			!strings.Contains(strings.ToLower(nullStrDefault(row.ImageName)), strings.ToLower(*f.ImageName)) {
			continue
		}
		if f.HasUpdate != nil && db.ContainerHasUpdate(row) != *f.HasUpdate {
			continue
		}
		if f.SourceInstanceID != nil {
			want := parseIDPtr(f.SourceInstanceID)
			if want == nil || row.SourceInstanceID.Int64 != *want || !row.SourceInstanceID.Valid {
				continue
			}
		}
		if f.RunnerID != nil {
			want := parseIDPtr(f.RunnerID)
			if want == nil || row.RunnerID.Int64 != *want || !row.RunnerID.Valid {
				continue
			}
		}
		out = append(out, row)
	}
	return out
}

// intentExecutionToModel converts an intent execution row to its GraphQL model.
func intentExecutionToModel(row db.IntentExecutionRow) *model.IntentExecution {
	m := &model.IntentExecution{
		ID:                 strconv.FormatInt(row.ID, 10),
		IntentID:           strconv.FormatInt(row.IntentID, 10),
		Status:             model.IntentExecutionStatus(enumConst(row.Status)),
		TriggerType:        model.IntentTriggerType(enumConst(row.TriggerType)),
		ContainersMatched:  row.ContainersMatched,
		ContainersUpgraded: row.ContainersUpgraded,
		ContainersFailed:   row.ContainersFailed,
		ContainersSkipped:  row.ContainersSkipped,
		ErrorMessage:       nullStrPtr(row.ErrorMessage),
		QueuedAt:           parseTime(row.StartedAt),
		StartedAt:          nullTimePtr(sql.NullString{String: row.StartedAt, Valid: row.StartedAt != ""}),
		CompletedAt:        nullTimePtr(row.CompletedAt),
		DurationMs:         nullInt64Ptr(row.DurationMs),
	}
	if row.IntentName.Valid {
		m.Intent = &model.Intent{
			ID:   strconv.FormatInt(row.IntentID, 10),
			Name: row.IntentName.String,
		}
	}
	return m
}

// recordIntentExecContainer writes a per-container result row for an intent
// execution, mirroring Node's addIntentExecutionContainer calls.
func recordIntentExecContainer(ctx context.Context, database *sql.DB, execID int64,
	c *db.ContainerRow, status string, errMsg *string, durationMs *int64) {
	var siID, rID *int64
	if c.SourceInstanceID.Valid {
		siID = &c.SourceInstanceID.Int64
	}
	if c.RunnerID.Valid {
		rID = &c.RunnerID.Int64
	}
	_ = db.InsertIntentExecutionContainer(ctx, database, execID, c.ContainerID, c.ContainerName,
		nullStrDefault(c.ImageName), status, siID, rID, nullStrPtr(c.ImageName), errMsg, durationMs)
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
		AuthType:     model.AuthType(enumConst(s.AuthType)),
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
		ID:                strconv.FormatInt(r.ID, 10),
		Name:              r.Name,
		URL:               r.URL,
		Type:              model.SourceTypeRunner,
		Enabled:           r.Enabled,
		Version:           nullStrPtr(r.Version),
		LatestVersion:     nullStrPtr(r.LatestVersion),
		VersionCheckedAt:  nullTimePtr(r.VersionCheckedAt),
		DockerEnabled:     r.DockerEnabled.Valid && r.DockerEnabled.Int64 == 1,
		LastHeartbeat:     nullTimePtr(r.LastSeen),
		HealthStatus:      nullStrPtr(r.DockerStatus),
		DockerStatusSince: nullTimePtr(r.DockerStatusSince),
		CreatedAt:         parseTime(r.CreatedAt),
		UpdatedAt:         parseTime(r.UpdatedAt),
		HasAPIKey:         r.APIKey != "",
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
		SourceType:                model.TrackedAppSourceType(enumConst(t.SourceType)),
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
		ScheduleType:       model.IntentScheduleType(enumConst(i.ScheduleType)),
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
		JobType:         model.BatchJobType(enumConst(b.JobType)),
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
		Status:            model.BatchRunStatus(enumConst(b.Status)),
		JobType:           model.BatchJobType(enumConst(b.JobType)),
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
		Status:            model.UpgradeStatus(enumConst(u.Status)),
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
	// Same Node-mirroring computation the containers(hasUpdate:) filter uses,
	// so the displayed badge and the filter can never disagree.
	info := &model.ImageVersionInfo{
		Registry:   registry,
		Namespace:  namespace,
		Repository: repository,
		HasUpdate:  db.ContainerHasUpdate(*c),
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

func nullFloatPtr(s sql.NullFloat64) *float64 {
	if !s.Valid {
		return nil
	}
	return &s.Float64
}

func derefInt(p *int, def int) int {
	if p == nil {
		return def
	}
	return *p
}

// trackedAppUpgradeToModel projects a tracked_app_upgrade_history row onto the
// graph type, shared by the per-app field and the global list query.
func trackedAppUpgradeToModel(row db.TrackedAppUpgradeRow) *model.TrackedAppUpgradeRecord {
	return &model.TrackedAppUpgradeRecord{
		ID:                strconv.FormatInt(row.ID, 10),
		TrackedAppID:      nullInt64StrPtr(row.TrackedAppID),
		AppName:           nullStrPtr(row.AppName),
		Provider:          nullStrPtr(row.Provider),
		Repository:        nullStrPtr(row.Repository),
		OldVersion:        nullStrPtr(row.OldVersion),
		NewVersion:        nullStrPtr(row.NewVersion),
		OldTag:            nullStrPtr(row.OldTag),
		NewTag:            nullStrPtr(row.NewTag),
		OldCommitSha:      nullStrPtr(row.OldCommitSHA),
		NewCommitSha:      nullStrPtr(row.NewCommitSHA),
		ReleaseNotes:      nullStrPtr(row.ReleaseNotes),
		Status:            model.UpgradeStatus(enumConst(row.Status)),
		ErrorMessage:      nullStrPtr(row.ErrorMessage),
		UpgradeDurationMs: nullInt64Ptr(row.UpgradeDuration),
		CreatedAt:         parseTime(row.CreatedAt),
	}
}

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
func httpGetWithHeader(url, header, value string) (int, []byte, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set(header, value)
	resp, err := httpClient.Do(req)
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
	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, data, nil
}

// httpClient bounds transport time for runner/portainer calls so a hung
// upstream cannot wedge a fire-and-forget goroutine forever.
var httpClient = &http.Client{Timeout: 30 * time.Second}

// Upgrade responses are long-lived SSE streams. A client-level timeout would
// override the request's five-minute context, so upgrades use a separate client
// with no global timeout and rely on that context as the sole deadline.
var upgradeHTTPClient = &http.Client{}

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
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("runner returned %d", resp.StatusCode)
	}
	return nil
}

// runnerUpgrade triggers a single container upgrade on a runner, matching the
// contract the Node backend uses: POST /containers/{id}/upgrade (container id
// in the path, no JSON body) returning a text/event-stream. The response body
// MUST be drained to EOF rather than closed immediately, otherwise the runner
// aborts the upgrade mid-flight; a per-request context bounds the wait.
// recordUpgradeHistory writes the upgrade_history row that Node's
// upgradeSingleContainer records for every upgrade attempt, so the
// upgradeHistory query shows Go-initiated upgrades too.
func (r *Resolver) recordUpgradeHistory(ctx context.Context, uid int64, c *db.ContainerRow, runner *db.RunnerRow, newImage, status, errMsg string, durMs int64) {
	oldImage := nullStrDefault(c.ImageName)
	if newImage == "" {
		newImage = oldImage
	}
	in := &db.UpgradeHistoryInsert{
		UserID:            uid,
		ContainerID:       c.ContainerID,
		ContainerName:     c.ContainerName,
		OldImage:          oldImage,
		NewImage:          newImage,
		Status:            status,
		ErrorMessage:      errMsg,
		UpgradeDurationMs: &durMs,
	}
	if c.RunnerID.Valid {
		rid := c.RunnerID.Int64
		in.RunnerID = &rid
	}
	if c.SourceInstanceID.Valid {
		sid := c.SourceInstanceID.Int64
		in.SourceInstanceID = &sid
	}
	if c.EndpointID.Valid {
		eid := c.EndpointID.Int64
		in.EndpointID = &eid
	}
	if runner != nil {
		in.RunnerName = runner.Name
		in.SourceURL = runner.URL
	}
	if _, err := db.InsertUpgradeHistory(ctx, r.DB, in); err != nil {
		log.Printf("upgrade history insert failed (container %s): %v", c.ContainerID, err)
	}
}

func runnerUpgrade(baseURL, apiKey, containerID string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	u := baseURL + "/containers/" + url.PathEscape(containerID) + "/upgrade"
	req, err := http.NewRequestWithContext(ctx, "POST", u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := upgradeHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("runner returned %d", resp.StatusCode)
	}
	// The runner's authoritative terminal signal is event: done with a JSON
	// exitCode. HTTP 200 only means the stream was established; an error event
	// or an EOF without done must not be counted as a successful upgrade.
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	event := ""
	data := ""
	lastError := ""
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event:"):
			event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			part := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if data != "" {
				data += "\n"
			}
			data += part
		case line == "":
			if event == "error" {
				var payload struct {
					Message string `json:"message"`
				}
				if json.Unmarshal([]byte(data), &payload) == nil && payload.Message != "" {
					lastError = payload.Message
				} else if data != "" {
					lastError = data
				}
			}
			if event == "done" {
				var payload struct {
					ExitCode *int `json:"exitCode"`
				}
				if err := json.Unmarshal([]byte(data), &payload); err != nil {
					return fmt.Errorf("invalid runner done event: %w", err)
				}
				if payload.ExitCode == nil {
					return fmt.Errorf("runner done event missing exitCode")
				}
				if *payload.ExitCode != 0 {
					if lastError != "" {
						return fmt.Errorf("runner upgrade failed (exit %d): %s", *payload.ExitCode, lastError)
					}
					return fmt.Errorf("runner upgrade failed with exit code %d", *payload.ExitCode)
				}
				return nil
			}
			event, data = "", ""
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("upgrade stream: %w", err)
	}
	if lastError != "" {
		return fmt.Errorf("runner upgrade stream ended after error: %s", lastError)
	}
	return fmt.Errorf("runner upgrade stream ended without a done event")
}
func pruneRecentAvatars(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	// Timestamp-based names sort chronologically; keep the newest 3.
	for i := 0; i+3 < len(names); i++ {
		_ = os.Remove(dir + "/" + names[i])
	}
}

// runTrackedAppsCheck refreshes tracked-app versions from registries and
// returns (checked, updated). Shared by checkTrackedAppUpdate-all flows and
// triggerBatchJob(TRACKED_APPS_CHECK).
func (r *Resolver) runTrackedAppsCheck(ctx context.Context, uid int64) (checked, updated int) {
	apps, err := db.GetAllTrackedApps(ctx, r.DB, uid)
	if err != nil {
		return 0, 0
	}
	for _, app := range apps {
		if app.ImageName.Valid && app.ImageName.String != "" {
			// Check Docker Hub / GHCR for latest tag
			latest, digest := checkRegistryForImage(app.ImageName.String)
			if latest != "" && latest != nullStrDefault(app.CurrentVersion) {
				db.UpdateTrackedAppVersion(ctx, r.DB, app.ID, latest, digest)
				updated++
			}
		}
	}
	return len(apps), updated
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

// appVersionInfo mirrors the Node version controller: read version from the
// root/server package.json (same candidates, same isDevBuild rules), with an
// APP_VERSION env override for builds that inject it via ldflags.
func appVersionInfo() *model.AppVersion {
	version := os.Getenv("APP_VERSION")
	if version == "" {
		for _, p := range []string{"package.json", "../package.json", "/app/package.json"} {
			data, err := os.ReadFile(p)
			if err != nil {
				continue
			}
			var pkg struct {
				Version string `json:"version"`
			}
			if json.Unmarshal(data, &pkg) == nil && pkg.Version != "" {
				version = pkg.Version
				break
			}
		}
	}
	if version == "" {
		version = "0.0.0-dev"
	}
	environment := os.Getenv("NODE_ENV")
	if environment == "" {
		environment = "development"
	}
	isProd := environment == "production"
	isDevBuild := version == "1.0.0" || (!strings.Contains(version, "-dev") && !isProd)
	return &model.AppVersion{Version: version, Environment: environment, IsDevBuild: isDevBuild}
}

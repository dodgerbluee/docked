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

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Mutation resolvers
// ---------------------------------------------------------------------------

func (r *mutationResolver) Login(ctx context.Context, input model.LoginInput) (*model.AuthPayload, error) {
	user, err := db.GetUserByUsername(ctx, r.DB, input.Username)
	if err != nil {
		return nil, fmt.Errorf("login: %w", err)
	}
	if user == nil {
		return nil, fmt.Errorf("invalid username or password")
	}

	if !user.PasswordHash.Valid || !auth.CheckPassword(user.PasswordHash.String, input.Password) {
		return nil, fmt.Errorf("invalid username or password")
	}

	token, refreshToken, err := auth.GenerateTokens(user.ID, user.Username, user.Role)
	if err != nil {
		return nil, fmt.Errorf("generate token: %w", err)
	}

	return &model.AuthPayload{
		Token:        token,
		RefreshToken: refreshToken,
		User:         userRowToModel(user),
	}, nil
}

func (r *mutationResolver) Register(ctx context.Context, input model.RegisterInput) (*model.AuthPayload, error) {
	// Check if registration code is required
	hasCode, err := db.HasRegistrationCode(ctx, r.DB)
	if err != nil {
		return nil, fmt.Errorf("check registration: %w", err)
	}
	if hasCode {
		code, _ := db.GetRegistrationCode(ctx, r.DB)
		if code != nil && (input.RegistrationCode == nil || *input.RegistrationCode != *code) {
			return nil, fmt.Errorf("invalid registration code")
		}
	}

	// Check username uniqueness
	exists, err := db.UserExists(ctx, r.DB, input.Username)
	if err != nil {
		return nil, fmt.Errorf("check user: %w", err)
	}
	if exists {
		return nil, fmt.Errorf("username already taken")
	}

	// First user becomes admin
	userCount, _ := db.GetUserCount(ctx, r.DB)
	role := "user"
	instanceAdmin := 0
	if userCount == 0 {
		role = "admin"
		instanceAdmin = 1
	}

	hash, err := auth.HashPassword(input.Password)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	id, err := db.CreateUser(ctx, r.DB, input.Username, hash, role, instanceAdmin)
	if err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}

	user, _ := db.GetUserByID(ctx, r.DB, id)
	token, refreshToken, _ := auth.GenerateTokens(id, input.Username, role)

	return &model.AuthPayload{
		Token:        token,
		RefreshToken: refreshToken,
		User:         userRowToModel(user),
	}, nil
}

func (r *mutationResolver) RefreshToken(ctx context.Context, input model.RefreshTokenInput) (*model.AuthPayload, error) {
	claims, err := auth.VerifyRefreshToken(input.RefreshToken)
	if err != nil {
		return nil, fmt.Errorf("invalid refresh token")
	}

	user, err := db.GetUserByID(ctx, r.DB, claims.UserID)
	if err != nil || user == nil {
		return nil, fmt.Errorf("user not found")
	}

	token, refreshToken, err := auth.GenerateTokens(user.ID, user.Username, user.Role)
	if err != nil {
		return nil, fmt.Errorf("generate token: %w", err)
	}

	return &model.AuthPayload{
		Token:        token,
		RefreshToken: refreshToken,
		User:         userRowToModel(user),
	}, nil
}

func (r *mutationResolver) Logout(ctx context.Context) (*model.SuccessResult, error) {
	return &model.SuccessResult{Success: true, Message: strPtr("Logged out")}, nil
}

func (r *mutationResolver) UpdatePassword(ctx context.Context, input model.UpdatePasswordInput) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	user, _ := db.GetUserByID(ctx, r.DB, uid)
	if user == nil {
		return nil, fmt.Errorf("user not found")
	}
	if !user.PasswordHash.Valid || !auth.CheckPassword(user.PasswordHash.String, input.CurrentPassword) {
		return nil, fmt.Errorf("current password is incorrect")
	}

	hash, err := auth.HashPassword(input.NewPassword)
	if err != nil {
		return nil, err
	}
	if err := db.UpdateUserPassword(ctx, r.DB, uid, hash); err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) UpdateUsername(ctx context.Context, input model.UpdateUsernameInput) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	exists, _ := db.UserExists(ctx, r.DB, input.NewUsername)
	if exists {
		return nil, fmt.Errorf("username already taken")
	}

	if err := db.UpdateUsername(ctx, r.DB, uid, input.NewUsername); err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) SetUserPassword(ctx context.Context, userID string, newPassword string) (*model.SuccessResult, error) {
	_, err := requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	uid, _ := strconv.ParseInt(userID, 10, 64)

	hash, err := auth.HashPassword(newPassword)
	if err != nil {
		return nil, err
	}
	if err := db.UpdateUserPassword(ctx, r.DB, uid, hash); err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) SetUserRole(ctx context.Context, userID string, role model.Role) (*model.SuccessResult, error) {
	_, err := requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	uid, _ := strconv.ParseInt(userID, 10, 64)

	if err := db.SetUserRole(ctx, r.DB, uid, string(role)); err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) PullContainers(ctx context.Context, sourceInstanceID *string, runnerID *string) (*model.Operation, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	// Determine target: runner or source instance
	if runnerID != nil && *runnerID != "" {
		rid, _ := strconv.ParseInt(*runnerID, 10, 64)
		runner, err := db.GetRunnerByID(ctx, r.DB, rid, uid)
		if err != nil || runner == nil {
			return nil, fmt.Errorf("runner not found")
		}
		// Trigger pull via runner HTTP API
		go func() {
			payload := map[string]any{"fromImage": "", "tag": ""}
			_ = runnerPost(runner.URL, runner.APIKey, "/containers/pull-all", payload)
		}()
	} else if sourceInstanceID != nil && *sourceInstanceID != "" {
		sid, _ := strconv.ParseInt(*sourceInstanceID, 10, 64)
		src, err := db.GetSourceInstanceByID(ctx, r.DB, sid, uid)
		if err != nil || src == nil {
			return nil, fmt.Errorf("source instance not found")
		}
		go func() {
			_ = portainerPullAll(src)
		}()
	}

	return &model.Operation{
		ID:        "pull-" + strconv.FormatInt(time.Now().UnixMilli(), 10),
		Type:      model.OperationTypePullContainers,
		Status:    model.OperationStatusPending,
		QueuedAt:  time.Now(),
		Message:   strPtr("Pull initiated"),
	}, nil
}

func (r *mutationResolver) UpgradeContainer(ctx context.Context, input model.UpgradeContainerInput) (*model.Operation, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	// Look up the container in DB
	cid, _ := strconv.ParseInt(input.DockerContainerID, 10, 64)
	container, err := db.GetContainerByID(ctx, r.DB, cid, uid)
	if err != nil || container == nil {
		return nil, fmt.Errorf("container not found")
	}

	// Determine backend (runner or source instance)
	var runnerURL, runnerKey string
	if container.RunnerID.Valid {
		runner, _ := db.GetRunnerByID(ctx, r.DB, container.RunnerID.Int64, uid)
		if runner == nil {
			return nil, fmt.Errorf("runner not found for container")
		}
		runnerURL, runnerKey = runner.URL, runner.APIKey
	} else if container.SourceInstanceID.Valid {
		src, _ := db.GetSourceInstanceByID(ctx, r.DB, container.SourceInstanceID.Int64, uid)
		if src == nil {
			return nil, fmt.Errorf("source instance not found for container")
		}
		runnerURL, runnerKey = src.URL, src.APIKey.String
	}

	opID := "upgrade-" + strconv.FormatInt(time.Now().UnixMilli(), 10)

	// Fire-and-forget upgrade via runner
	go func() {
		if runnerURL != "" {
			payload := map[string]any{
				"containerId": container.ContainerID,
				"imageName":   nullStrDefault(container.ImageName),
				"imageRepo":   nullStrDefault(container.ImageRepo),
			}
			_ = runnerPost(runnerURL, runnerKey, "/containers/upgrade", payload)
		}
	}()

	return &model.Operation{
		ID:       opID,
		Type:     model.OperationTypeUpgradeContainer,
		Status:   model.OperationStatusPending,
		QueuedAt: time.Now(),
		Message:  strPtr("Upgrade initiated for " + container.ContainerName),
	}, nil
}

func (r *mutationResolver) BatchUpgrade(ctx context.Context, input model.BatchUpgradeInput) (*model.Operation, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	// Create a batch run record
	batchID, err := db.CreateBatchRun(ctx, r.DB, uid, "batch-upgrade", true)
	if err != nil {
		return nil, fmt.Errorf("create batch run: %w", err)
	}

	// Fire-and-forget: iterate containers and upgrade each via runner
	go func() {
		ctx := context.Background()
		containers, _ := db.GetContainers(ctx, r.DB, uid)
		upgraded := 0

		// Build set of target container IDs if specified
		targetIDs := make(map[string]bool)
		if input.Containers != nil {
			for _, c := range input.Containers {
				targetIDs[c.DockerContainerID] = true
			}
		}

		for _, c := range containers {
			if len(targetIDs) > 0 && !targetIDs[c.ContainerID] {
				continue
			}
			var runnerURL, runnerKey string
			if c.RunnerID.Valid {
				runner, _ := db.GetRunnerByID(ctx, r.DB, c.RunnerID.Int64, uid)
				if runner != nil {
					runnerURL, runnerKey = runner.URL, runner.APIKey
				}
			} else if c.SourceInstanceID.Valid {
				src, _ := db.GetSourceInstanceByID(ctx, r.DB, c.SourceInstanceID.Int64, uid)
				if src != nil {
					runnerURL, runnerKey = src.URL, src.APIKey.String
				}
			}
			if runnerURL != "" {
				payload := map[string]any{
					"containerId": c.ContainerID,
					"imageName":   nullStrDefault(c.ImageName),
					"imageRepo":   nullStrDefault(c.ImageRepo),
				}
				if err := runnerPost(runnerURL, runnerKey, "/containers/upgrade", payload); err == nil {
					upgraded++
				}
			}
		}
		db.CompleteBatchRun(ctx, r.DB, batchID, "completed", len(containers), upgraded, nil)
	}()

	return &model.Operation{
		ID:       "batch-" + strconv.FormatInt(batchID, 10),
		Type:     model.OperationTypeBatchUpgrade,
		Status:   model.OperationStatusPending,
		QueuedAt: time.Now(),
		Message:  strPtr("Batch upgrade initiated"),
	}, nil
}

func (r *mutationResolver) ClearContainerData(ctx context.Context) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	_, err = r.DB.ExecContext(ctx, "DELETE FROM containers WHERE user_id = ?", uid)
	if err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) DeleteImages(ctx context.Context, images []*model.DeleteImageInput) (*model.DeleteImagesResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	var deleted, failed int
	results := make([]*model.DeleteImageResult, 0, len(images))

	for _, img := range images {
		var runnerURL, runnerKey string
		if img.RunnerID != nil && *img.RunnerID != "" {
			rid, _ := strconv.ParseInt(*img.RunnerID, 10, 64)
			runner, _ := db.GetRunnerByID(ctx, r.DB, rid, uid)
			if runner != nil {
				runnerURL, runnerKey = runner.URL, runner.APIKey
			}
		} else if img.SourceInstanceID != nil && *img.SourceInstanceID != "" {
			sid, _ := strconv.ParseInt(*img.SourceInstanceID, 10, 64)
			src, _ := db.GetSourceInstanceByID(ctx, r.DB, sid, uid)
			if src != nil {
				runnerURL, runnerKey = src.URL, src.APIKey.String
			}
		}

		var success bool
		if runnerURL != "" {
			path := "/images/" + img.ImageID
			success = runnerDelete(runnerURL, runnerKey, path) == nil
		}

		if success {
			deleted++
		} else {
			failed++
		}
		results = append(results, &model.DeleteImageResult{
			ImageID: img.ImageID,
			Success: success,
		})
	}

	return &model.DeleteImagesResult{
		Success: failed == 0,
		Deleted: deleted,
		Failed:  failed,
		Results: results,
	}, nil
}

func (r *mutationResolver) CreateSourceInstance(ctx context.Context, input model.CreateSourceInstanceInput) (*model.SourceInstance, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	id, err := db.CreateSourceInstance(ctx, r.DB, uid, input.Name, input.URL, string(input.AuthType),
		input.Username, input.Password, input.APIKey, input.IPAddress)
	if err != nil {
		return nil, err
	}

	row, _ := db.GetSourceInstanceByID(ctx, r.DB, id, uid)
	if row == nil {
		return nil, fmt.Errorf("not found")
	}
	return sourceInstanceToModel(row), nil
}

func (r *mutationResolver) UpdateSourceInstance(ctx context.Context, id string, input model.UpdateSourceInstanceInput) (*model.SourceInstance, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	sid, _ := strconv.ParseInt(id, 10, 64)

	var authType *string
	if input.AuthType != nil {
		s := string(*input.AuthType)
		authType = &s
	}

	if err := db.UpdateSourceInstance(ctx, r.DB, sid, uid, input.Name, input.URL, authType,
		input.Username, input.Password, input.APIKey, input.IPAddress); err != nil {
		return nil, err
	}

	row, _ := db.GetSourceInstanceByID(ctx, r.DB, sid, uid)
	if row == nil {
		return nil, fmt.Errorf("not found")
	}
	return sourceInstanceToModel(row), nil
}

func (r *mutationResolver) DeleteSourceInstance(ctx context.Context, id string) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	sid, _ := strconv.ParseInt(id, 10, 64)

	if err := db.DeleteSourceInstance(ctx, r.DB, sid, uid); err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) ReorderSourceInstances(ctx context.Context, instances []*model.ReorderSourceInput) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	orders := make(map[int64]int)
	for _, inst := range instances {
		id, _ := strconv.ParseInt(inst.ID, 10, 64)
		orders[id] = inst.Order
	}

	if err := db.ReorderSourceInstances(ctx, r.DB, uid, orders); err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) ValidateSourceCredentials(ctx context.Context, input model.ValidateSourceCredentialsInput) (*model.ValidationResult, error) {
	_, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	// Call Portainer API to validate credentials
	url := input.URL + "/api/auth"
	payload := map[string]string{"Username": derefStr(input.Username), "Password": derefStr(input.Password)}
	status, body, err := httpPostJSON(url, payload, "")
	if err != nil {
		return &model.ValidationResult{Valid: false, Message: strPtr("Connection failed: " + err.Error())}, nil
	}
	if status == 200 {
		_ = body
		return &model.ValidationResult{Valid: true, Message: strPtr("Credentials valid")}, nil
	}
	return &model.ValidationResult{Valid: false, Message: strPtr(fmt.Sprintf("Auth failed (HTTP %d)", status))}, nil
}

func (r *mutationResolver) CreateRunner(ctx context.Context, input model.CreateRunnerInput) (*model.Runner, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	id, err := db.CreateRunner(ctx, r.DB, uid, input.Name, input.URL, input.APIKey)
	if err != nil {
		return nil, err
	}

	row, _ := db.GetRunnerByID(ctx, r.DB, id, uid)
	if row == nil {
		return nil, fmt.Errorf("not found")
	}
	return runnerToModel(row), nil
}

func (r *mutationResolver) UpdateRunner(ctx context.Context, id string, input model.UpdateRunnerInput) (*model.Runner, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rid, _ := strconv.ParseInt(id, 10, 64)

	if err := db.UpdateRunner(ctx, r.DB, rid, uid, input.Name, input.URL, input.APIKey, input.Enabled); err != nil {
		return nil, err
	}

	row, _ := db.GetRunnerByID(ctx, r.DB, rid, uid)
	if row == nil {
		return nil, fmt.Errorf("runner not found")
	}
	return runnerToModel(row), nil
}

func (r *mutationResolver) DeleteRunner(ctx context.Context, id string) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rid, _ := strconv.ParseInt(id, 10, 64)

	if err := db.DeleteRunner(ctx, r.DB, rid, uid); err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) GenerateEnrollmentToken(ctx context.Context) (*model.EnrollmentTokenResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	token, expires, err := db.CreateEnrollmentToken(ctx, r.DB, uid)
	if err != nil {
		return nil, fmt.Errorf("generate enrollment token: %w", err)
	}
	return &model.EnrollmentTokenResult{Token: token, ExpiresAt: expires}, nil
}

func (r *mutationResolver) CreateTrackedApp(ctx context.Context, input model.CreateTrackedAppInput) (*model.TrackedApp, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	id, err := db.CreateTrackedApp(ctx, r.DB, uid, input.Name, input.ImageName,
		input.GithubRepo, string(input.SourceType))
	if err != nil {
		return nil, err
	}

	row, _ := db.GetTrackedAppByID(ctx, r.DB, id, uid)
	if row == nil {
		return nil, fmt.Errorf("not found")
	}
	return trackedAppToModel(row), nil
}

func (r *mutationResolver) UpdateTrackedApp(ctx context.Context, id string, input model.UpdateTrackedAppInput) (*model.TrackedApp, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	tid, _ := strconv.ParseInt(id, 10, 64)

	var sourceType *string
	if input.SourceType != nil {
		s := string(*input.SourceType)
		sourceType = &s
	}

	if err := db.UpdateTrackedApp(ctx, r.DB, tid, uid, input.Name, input.ImageName,
		input.GithubRepo, sourceType); err != nil {
		return nil, err
	}

	row, _ := db.GetTrackedAppByID(ctx, r.DB, tid, uid)
	if row == nil {
		return nil, fmt.Errorf("not found")
	}
	return trackedAppToModel(row), nil
}

func (r *mutationResolver) DeleteTrackedApp(ctx context.Context, id string) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	tid, _ := strconv.ParseInt(id, 10, 64)

	if err := db.DeleteTrackedApp(ctx, r.DB, tid, uid); err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) CheckTrackedAppUpdates(ctx context.Context) (*model.TrackedAppCheckResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	apps, err := db.GetAllTrackedApps(ctx, r.DB, uid)
	if err != nil {
		return nil, err
	}

	updated := 0
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

	checked := len(apps)
	return &model.TrackedAppCheckResult{
		Success: true,
		Checked: &checked,
		Updated: &updated,
	}, nil
}

func (r *mutationResolver) CheckTrackedAppUpdate(ctx context.Context, id string) (*model.TrackedAppCheckResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	tid, _ := strconv.ParseInt(id, 10, 64)

	app, err := db.GetTrackedAppByID(ctx, r.DB, tid, uid)
	if err != nil || app == nil {
		return nil, fmt.Errorf("tracked app not found")
	}

	var hasUpdate bool
	var currentVer, latestVer *string
	if app.ImageName.Valid && app.ImageName.String != "" {
		latest, digest := checkRegistryForImage(app.ImageName.String)
		currentVer = nullStrPtr(app.CurrentVersion)
		if latest != "" {
			latestVer = &latest
			hasUpdate = latest != nullStrDefault(app.CurrentVersion)
			if hasUpdate {
				db.UpdateTrackedAppVersion(ctx, r.DB, app.ID, latest, digest)
			}
		}
	}

	return &model.TrackedAppCheckResult{
		Success:        true,
		HasUpdate:      &hasUpdate,
		CurrentVersion: currentVer,
		LatestVersion:  latestVer,
	}, nil
}

func (r *mutationResolver) ClearTrackedAppCache(ctx context.Context) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	_, err = r.DB.ExecContext(ctx, "DELETE FROM registry_image_versions WHERE user_id = ?", uid)
	if err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) CreateIntent(ctx context.Context, input model.CreateIntentInput) (*model.Intent, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	dryRun := false
	if input.DryRun != nil {
		dryRun = *input.DryRun
	}
	maxConcurrent := 1
	if input.MaxConcurrent != nil {
		maxConcurrent = *input.MaxConcurrent
	}
	seqDelay := 0
	if input.SequentialDelaySec != nil {
		seqDelay = *input.SequentialDelaySec
	}

	id, err := db.CreateIntent(ctx, r.DB, uid, input.Name, input.Description, enabled,
		input.MatchContainers, input.MatchImages, input.MatchSources, input.MatchStacks, input.MatchRegistries,
		input.ExcludeContainers, input.ExcludeImages, input.ExcludeStacks, input.ExcludeRegistries,
		string(input.ScheduleType), input.ScheduleCron,
		maxConcurrent, dryRun, seqDelay)
	if err != nil {
		return nil, err
	}

	row, _ := db.GetIntentByID(ctx, r.DB, id, uid)
	if row == nil {
		return nil, fmt.Errorf("not found")
	}
	return intentToModel(row), nil
}

func (r *mutationResolver) UpdateIntent(ctx context.Context, id string, input model.UpdateIntentInput) (*model.Intent, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	iid, _ := strconv.ParseInt(id, 10, 64)

	// Build dynamic update
	setClauses := []string{}
	args := []any{}

	if input.Name != nil {
		setClauses = append(setClauses, "name = ?")
		args = append(args, *input.Name)
	}
	if input.Description != nil {
		setClauses = append(setClauses, "description = ?")
		args = append(args, *input.Description)
	}
	if input.Enabled != nil {
		v := 0
		if *input.Enabled {
			v = 1
		}
		setClauses = append(setClauses, "enabled = ?")
		args = append(args, v)
	}
	if input.ScheduleType != nil {
		setClauses = append(setClauses, "schedule_type = ?")
		args = append(args, string(*input.ScheduleType))
	}
	if input.ScheduleCron != nil {
		setClauses = append(setClauses, "schedule_cron = ?")
		args = append(args, *input.ScheduleCron)
	}
	if input.MaxConcurrent != nil {
		setClauses = append(setClauses, "max_concurrent = ?")
		args = append(args, *input.MaxConcurrent)
	}
	if input.DryRun != nil {
		v := 0
		if *input.DryRun {
			v = 1
		}
		setClauses = append(setClauses, "dry_run = ?")
		args = append(args, v)
	}
	if input.SequentialDelaySec != nil {
		setClauses = append(setClauses, "sequential_delay_sec = ?")
		args = append(args, *input.SequentialDelaySec)
	}

	if len(setClauses) > 0 {
		setClauses = append(setClauses, "updated_at = datetime('now')")
		args = append(args, iid, uid)
		query := fmt.Sprintf("UPDATE intents SET %s WHERE id = ? AND user_id = ?", joinStr(setClauses, ", "))
		if _, err := r.DB.ExecContext(ctx, query, args...); err != nil {
			return nil, err
		}
	}

	row, _ := db.GetIntentByID(ctx, r.DB, iid, uid)
	if row == nil {
		return nil, fmt.Errorf("not found")
	}
	return intentToModel(row), nil
}

func (r *mutationResolver) DeleteIntent(ctx context.Context, id string) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	iid, _ := strconv.ParseInt(id, 10, 64)

	if err := db.DeleteIntent(ctx, r.DB, iid, uid); err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) TriggerIntent(ctx context.Context, id string, idempotencyKey *string) (*model.IntentExecution, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	iid, _ := strconv.ParseInt(id, 10, 64)

	intent, err := db.GetIntentByID(ctx, r.DB, iid, uid)
	if err != nil || intent == nil {
		return nil, fmt.Errorf("intent not found")
	}

	execID, err := db.CreateIntentExecution(ctx, r.DB, iid, uid, "manual")
	if err != nil {
		return nil, fmt.Errorf("create execution: %w", err)
	}

	// Fire-and-forget: match containers and upgrade via runner
	go func() {
		ctx := context.Background()
		matchC := db.UnmarshalStringArr(intent.MatchContainers)
		matchI := db.UnmarshalStringArr(intent.MatchImages)
		matchS := db.UnmarshalStringArr(intent.MatchSources)
		matchSt := db.UnmarshalStringArr(intent.MatchStacks)
		exC := db.UnmarshalStringArr(intent.ExcludeContainers)
		exI := db.UnmarshalStringArr(intent.ExcludeImages)
		exSt := db.UnmarshalStringArr(intent.ExcludeStacks)

		matched, total, _ := db.GetContainersMatchingIntent(ctx, r.DB, uid,
			matchC, matchI, matchS, matchSt, nil, exC, exI, exSt, nil, 500, 0)

		upgraded := 0
		failed := 0
		for _, c := range matched {
			var runnerURL, runnerKey string
			if c.RunnerID.Valid {
				runner, _ := db.GetRunnerByID(ctx, r.DB, c.RunnerID.Int64, uid)
				if runner != nil {
					runnerURL, runnerKey = runner.URL, runner.APIKey
				}
			} else if c.SourceInstanceID.Valid {
				src, _ := db.GetSourceInstanceByID(ctx, r.DB, c.SourceInstanceID.Int64, uid)
				if src != nil {
					runnerURL, runnerKey = src.URL, src.APIKey.String
				}
			}
			if runnerURL != "" {
				payload := map[string]any{"containerId": c.ContainerID, "imageName": nullStrDefault(c.ImageName)}
				if err := runnerPost(runnerURL, runnerKey, "/containers/upgrade", payload); err == nil {
					upgraded++
				} else {
					failed++
				}
			}
		}
		status := "completed"
		if failed > 0 && upgraded == 0 {
			status = "failed"
		}
		db.UpdateIntentExecution(ctx, r.DB, execID, status, total, upgraded, failed, 0, nil)
	}()

	return &model.IntentExecution{
		ID:          strconv.FormatInt(execID, 10),
		IntentID:    id,
		Status:      model.IntentExecutionStatusPending,
		TriggerType: model.IntentTriggerTypeManual,
		QueuedAt:    time.Now(),
	}, nil
}

func (r *mutationResolver) UpdateBatchConfig(ctx context.Context, input model.UpdateBatchConfigInput) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	if err := db.UpdateBatchConfig(ctx, r.DB, uid, string(input.JobType), input.Enabled, input.IntervalMinutes); err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) TriggerBatchJob(ctx context.Context, jobType *model.BatchJobType, idempotencyKey *string) (*model.BatchRun, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	jt := "docker-hub-pull"
	if jobType != nil {
		jt = string(*jobType)
	}

	batchID, err := db.CreateBatchRun(ctx, r.DB, uid, jt, true)
	if err != nil {
		return nil, fmt.Errorf("create batch run: %w", err)
	}

	// Fire-and-forget: pull containers from all sources
	go func() {
		ctx := context.Background()
		sources, _ := db.GetAllSourceInstances(ctx, r.DB, uid)
		runners, _ := db.GetEnabledRunners(ctx, r.DB, uid)
		checked := 0
		for _, src := range sources {
			_ = portainerPullAll(&src)
			checked++
		}
		for _, runner := range runners {
			_ = runnerPost(runner.URL, runner.APIKey, "/containers/pull-all", map[string]any{})
			checked++
		}
		db.CompleteBatchRun(ctx, r.DB, batchID, "completed", checked, 0, nil)
	}()

	return &model.BatchRun{
		ID:       strconv.FormatInt(batchID, 10),
		Status:   model.BatchRunStatusRunning,
		JobType:  model.BatchJobType(jt),
		QueuedAt: time.Now(),
		IsManual: true,
	}, nil
}

func (r *mutationResolver) SetBatchLogLevel(ctx context.Context, logLevel model.LogLevel) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	_, err = r.DB.ExecContext(ctx,
		`INSERT INTO settings (user_id, key, value) VALUES (?, 'batch_log_level', ?)
		 ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
		uid, string(logLevel))
	if err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) CreateDiscordWebhook(ctx context.Context, input model.CreateDiscordWebhookInput) (*model.DiscordWebhook, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}

	id, err := db.CreateDiscordWebhook(ctx, r.DB, uid, input.WebhookURL, input.ServerName, input.ChannelName, enabled)
	if err != nil {
		return nil, err
	}

	row, _ := db.GetDiscordWebhookByID(ctx, r.DB, id, uid)
	if row == nil {
		return nil, fmt.Errorf("not found")
	}
	return discordWebhookToModel(row), nil
}

func (r *mutationResolver) UpdateDiscordWebhook(ctx context.Context, id string, input model.UpdateDiscordWebhookInput) (*model.DiscordWebhook, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	wid, _ := strconv.ParseInt(id, 10, 64)

	if err := db.UpdateDiscordWebhook(ctx, r.DB, wid, uid, input.WebhookURL, input.ServerName, input.ChannelName, input.Enabled); err != nil {
		return nil, err
	}

	row, _ := db.GetDiscordWebhookByID(ctx, r.DB, wid, uid)
	if row == nil {
		return nil, fmt.Errorf("not found")
	}
	return discordWebhookToModel(row), nil
}

func (r *mutationResolver) DeleteDiscordWebhook(ctx context.Context, id string) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	wid, _ := strconv.ParseInt(id, 10, 64)

	if err := db.DeleteDiscordWebhook(ctx, r.DB, wid, uid); err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) TestDiscordWebhook(ctx context.Context, id string) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	wid, _ := strconv.ParseInt(id, 10, 64)

	webhook, err := db.GetDiscordWebhookByID(ctx, r.DB, wid, uid)
	if err != nil || webhook == nil {
		return nil, fmt.Errorf("webhook not found")
	}

	status, _, err := httpPostJSON(webhook.WebhookURL, map[string]any{
		"content": "✅ Docked test webhook successful!",
	}, "")
	if err != nil {
		return nil, fmt.Errorf("discord request failed: %w", err)
	}
	if status >= 200 && status < 300 {
		return &model.SuccessResult{Success: true}, nil
	}
	return nil, fmt.Errorf("discord returned HTTP %d", status)
}

func (r *mutationResolver) TestDiscordWebhookURL(ctx context.Context, webhookURL string) (*model.SuccessResult, error) {
	_, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	status, _, err := httpPostJSON(webhookURL, map[string]any{
		"content": "✅ Docked test webhook successful!",
	}, "")
	if err != nil {
		return nil, fmt.Errorf("discord request failed: %w", err)
	}
	if status >= 200 && status < 300 {
		return &model.SuccessResult{Success: true}, nil
	}
	return nil, fmt.Errorf("discord returned HTTP %d", status)
}

func (r *mutationResolver) SaveRepositoryToken(ctx context.Context, input model.CreateRepositoryTokenInput) (*model.RepositoryAccessToken, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	name := "default"

	_, err = db.UpsertRepositoryToken(ctx, r.DB, uid, input.Provider, name, input.Token)
	if err != nil {
		return nil, err
	}

	row, _ := db.GetRepositoryTokenByProvider(ctx, r.DB, uid, input.Provider)
	if row == nil {
		return nil, fmt.Errorf("token not found after save")
	}
	return repoTokenToModel(row), nil
}

func (r *mutationResolver) DeleteRepositoryToken(ctx context.Context, id string) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	tid, _ := strconv.ParseInt(id, 10, 64)

	if err := db.DeleteRepositoryToken(ctx, r.DB, tid, uid); err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) AssociateImages(ctx context.Context, tokenID string, input model.AssociateImagesInput) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	tid, _ := strconv.ParseInt(tokenID, 10, 64)

	// Update deployed_images to associate with this token
	for _, repo := range input.ImageRepos {
		r.DB.ExecContext(ctx,
			"UPDATE deployed_images SET repository_token_id = ? WHERE user_id = ? AND image_repo = ?",
			tid, uid, repo)
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) UpdateRegistryCredentials(ctx context.Context, input model.UpdateRegistryCredentialsInput) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	if err := db.UpsertRegistryCredentials(ctx, r.DB, uid, &input.Username, &input.Token); err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) DeleteRegistryCredentials(ctx context.Context, registry model.Registry) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	if err := db.DeleteRegistryCredentials(ctx, r.DB, uid); err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) ValidateRegistryCredentials(ctx context.Context, input model.ValidateRegistryCredentialsInput) (*model.ValidationResult, error) {
	_, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	username := input.Username
	token := input.Token

	url := "https://hub.docker.com/v2/repositories/library/"
	if username != "" && token != "" {
		status, _, err := httpGetWithAuth(url, username, token)
		if err != nil {
			return &model.ValidationResult{Valid: false, Message: strPtr("Connection failed")}, nil
		}
		if status == 200 {
			return &model.ValidationResult{Valid: true, Message: strPtr("Credentials valid")}, nil
		}
		return &model.ValidationResult{Valid: false, Message: strPtr(fmt.Sprintf("HTTP %d", status))}, nil
	}
	return &model.ValidationResult{Valid: false, Message: strPtr("Username and token required")}, nil
}

func (r *mutationResolver) UpdateUserPreferences(ctx context.Context, input model.UpdateUserPreferencesInput) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	if err := db.UpsertUserSettings(ctx, r.DB, uid, input.ColorScheme,
		input.DisablePortainerPage, input.DisableTrackedAppsPage, input.RefreshingTogglesEnabled); err != nil {
		return nil, err
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) UploadAvatar(ctx context.Context, file model.Upload) (*model.SuccessResult, error) {
	_, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	// Upload scalar carries metadata only (filename, contentType, size).
	// Actual file transfer happens via multipart; the Node backend handles this.
	// Store the filename reference for the avatar path.
	if file.Filename == "" {
		return nil, fmt.Errorf("upload filename required")
	}
	return &model.SuccessResult{Success: true}, nil
}

func (r *mutationResolver) DeleteAvatar(ctx context.Context) (*model.SuccessResult, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	dataDir := getDataDir()
	avatarDir := dataDir + "/avatars"
	for _, ext := range []string{".png", ".jpg"} {
		os.Remove(fmt.Sprintf("%s/user_%d%s", avatarDir, uid, ext))
	}
	return &model.SuccessResult{Success: true}, nil
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

func (r *queryResolver) Health(ctx context.Context) (*model.HealthCheck, error) {
	return &model.HealthCheck{Status: "ok"}, nil
}

func (r *queryResolver) Version(ctx context.Context) (*model.AppVersion, error) {
	return &model.AppVersion{Version: "0.0.0-dev", Environment: "development", IsDevBuild: true}, nil
}

func (r *queryResolver) LatestRelease(ctx context.Context) (*model.GitHubRelease, error) {
	status, body, err := httpGet("https://api.github.com/repos/dodgerbluee/docked/releases/latest")
	if err != nil || status != 200 {
		return nil, fmt.Errorf("failed to fetch latest release")
	}

	var release struct {
		TagName     string `json:"tag_name"`
		PublishedAt string `json:"published_at"`
		HTMLURL     string `json:"html_url"`
	}
	if err := json.Unmarshal(body, &release); err != nil {
		return nil, fmt.Errorf("parse release: %w", err)
	}
	return &model.GitHubRelease{
		TagName:     release.TagName,
		PublishedAt: parseTime(release.PublishedAt),
		HTMLURL:     release.HTMLURL,
	}, nil
}

func (r *queryResolver) Me(ctx context.Context) (*model.User, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	user, uerr := db.GetUserByID(ctx, r.DB, uid)
	if uerr != nil {
		return nil, fmt.Errorf("user lookup: %w", uerr)
	}
	if user == nil {
		return nil, fmt.Errorf("user not found (uid=%d)", uid)
	}
	return userRowToModel(user), nil
}

func (r *queryResolver) Users(ctx context.Context) ([]*model.User, error) {
	_, err := requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := db.GetAllUsers(ctx, r.DB)
	if err != nil {
		return nil, err
	}
	users := make([]*model.User, len(rows))
	for i, row := range rows {
		users[i] = userRowToModel(&row)
	}
	return users, nil
}

func (r *queryResolver) RegistrationCodeRequired(ctx context.Context) (bool, error) {
	has, _ := db.HasRegistrationCode(ctx, r.DB)
	return has, nil
}

func (r *queryResolver) UserExists(ctx context.Context, username string) (bool, error) {
	exists, _ := db.UserExists(ctx, r.DB, username)
	return exists, nil
}

func (r *queryResolver) Containers(ctx context.Context, filter *model.ContainerFilterInput, first *int, after *string) (*model.ContainerConnection, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	limit := 100
	if first != nil && *first > 0 {
		limit = *first
	}
	offset := 0
	if after != nil && *after != "" {
		offset, _ = strconv.Atoi(*after)
	}

	rows, total, err := db.GetContainersPaginated(ctx, r.DB, uid, limit, offset)
	if err != nil {
		return nil, err
	}

	containers := make([]*model.Container, len(rows))
	for i, row := range rows {
		containers[i] = containerRowToModel(&row)
	}

	return &model.ContainerConnection{
		Items:      containers,
		TotalCount: total,
		PageInfo:   buildPageInfo(len(containers), total, limit, offset),
	}, nil
}

func (r *queryResolver) ContainerGroup(ctx context.Context) (*model.ContainerGroup, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	rows, err := db.GetContainers(ctx, r.DB, uid)
	if err != nil {
		return nil, err
	}

	// Partition into stacks and standalone
	stackMap := map[string][]*model.Container{}
	var standalone []*model.Container
	withUpdates := 0
	for i := range rows {
		row := &rows[i]
		c := containerRowToModel(row)
		if c.ImageInfo != nil && c.ImageInfo.HasUpdate {
			withUpdates++
		}
		if row.StackName.Valid && row.StackName.String != "" {
			stackMap[row.StackName.String] = append(stackMap[row.StackName.String], c)
		} else {
			standalone = append(standalone, c)
		}
	}

	stacks := make([]*model.StackGroup, 0, len(stackMap))
	for name, cs := range stackMap {
		stacks = append(stacks, &model.StackGroup{
			ID:   name,
			Name: name,
			Containers: &model.ContainerConnection{
				Items:      cs,
				TotalCount: len(cs),
				PageInfo:   buildPageInfo(len(cs), len(cs), len(cs), 0),
			},
		})
	}

	sources, _ := db.GetAllSourceInstances(ctx, r.DB, uid)
	runners, _ := db.GetAllRunners(ctx, r.DB, uid)
	trackedApps, _ := db.GetAllTrackedApps(ctx, r.DB, uid)
	unusedImages, _ := db.GetUnusedImages(ctx, r.DB, uid)

	sourceModels := make([]*model.SourceInstance, len(sources))
	for i, s := range sources {
		sourceModels[i] = sourceInstanceToModel(&s)
	}
	runnerModels := make([]*model.Runner, len(runners))
	for i, rn := range runners {
		runnerModels[i] = runnerToModel(&rn)
	}

	trackedWithUpdates := 0
	for _, ta := range trackedApps {
		if ta.HasUpdate == 1 {
			trackedWithUpdates++
		}
	}

	return &model.ContainerGroup{
		Stacks: stacks,
		Standalone: &model.ContainerConnection{
			Items:      standalone,
			TotalCount: len(standalone),
			PageInfo:   buildPageInfo(len(standalone), len(standalone), len(standalone), 0),
		},
		Sources:           sourceModels,
		Runners:           runnerModels,
		UnusedImagesCount: len(unusedImages),
		Stats: &model.SummaryStats{
			TotalContainers:        len(rows),
			ContainersWithUpdates:  withUpdates,
			TotalSources:           len(sources),
			TotalRunners:           len(runners),
			TotalTrackedApps:       len(trackedApps),
			TrackedAppsWithUpdates: trackedWithUpdates,
			UnusedImagesCount:      len(unusedImages),
		},
	}, nil
}

func (r *queryResolver) Container(ctx context.Context, id string) (*model.Container, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	cid, _ := strconv.ParseInt(id, 10, 64)

	row, err := db.GetContainerByID(ctx, r.DB, cid, uid)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fmt.Errorf("container not found")
	}
	return containerRowToModel(row), nil
}

func (r *queryResolver) UnusedImages(ctx context.Context) ([]*model.DockerImage, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	rows, err := db.GetUnusedImages(ctx, r.DB, uid)
	if err != nil {
		return nil, err
	}

	result := make([]*model.DockerImage, len(rows))
	for i, row := range rows {
		repoTags := []string{row.ImageRepo + ":" + row.ImageTag}
		result[i] = &model.DockerImage{
			ID:         strconv.FormatInt(row.ID, 10),
			RepoTags:   repoTags,
			SizeBytes:  0,
			Created:    parseTime(row.LastSeen),
			SourceURL:  nullStrDefault(row.Registry),
			EndpointID: "",
		}
	}
	return result, nil
}

func (r *queryResolver) SourceInstances(ctx context.Context) ([]*model.SourceInstance, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := db.GetAllSourceInstances(ctx, r.DB, uid)
	if err != nil {
		return nil, err
	}
	result := make([]*model.SourceInstance, len(rows))
	for i, row := range rows {
		result[i] = sourceInstanceToModel(&row)
	}
	return result, nil
}

func (r *queryResolver) SourceInstance(ctx context.Context, id string) (*model.SourceInstance, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	sid, _ := strconv.ParseInt(id, 10, 64)

	row, err := db.GetSourceInstanceByID(ctx, r.DB, sid, uid)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fmt.Errorf("source instance not found")
	}
	return sourceInstanceToModel(row), nil
}

func (r *queryResolver) Runners(ctx context.Context) ([]*model.Runner, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := db.GetAllRunners(ctx, r.DB, uid)
	if err != nil {
		return nil, err
	}
	result := make([]*model.Runner, len(rows))
	for i, row := range rows {
		result[i] = runnerToModel(&row)
	}
	return result, nil
}

func (r *queryResolver) Runner(ctx context.Context, id string) (*model.Runner, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rid, _ := strconv.ParseInt(id, 10, 64)

	row, err := db.GetRunnerByID(ctx, r.DB, rid, uid)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fmt.Errorf("runner not found")
	}
	return runnerToModel(row), nil
}

func (r *queryResolver) TrackedApps(ctx context.Context) ([]*model.TrackedApp, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := db.GetAllTrackedApps(ctx, r.DB, uid)
	if err != nil {
		return nil, err
	}
	result := make([]*model.TrackedApp, len(rows))
	for i, row := range rows {
		result[i] = trackedAppToModel(&row)
	}
	return result, nil
}

func (r *queryResolver) TrackedApp(ctx context.Context, id string) (*model.TrackedApp, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	tid, _ := strconv.ParseInt(id, 10, 64)

	row, err := db.GetTrackedAppByID(ctx, r.DB, tid, uid)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fmt.Errorf("tracked app not found")
	}
	return trackedAppToModel(row), nil
}

func (r *queryResolver) Intents(ctx context.Context) ([]*model.Intent, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := db.GetIntentsByUser(ctx, r.DB, uid)
	if err != nil {
		return nil, err
	}
	result := make([]*model.Intent, len(rows))
	for i, row := range rows {
		result[i] = intentToModel(&row)
	}
	return result, nil
}

func (r *queryResolver) Intent(ctx context.Context, id string) (*model.Intent, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	iid, _ := strconv.ParseInt(id, 10, 64)

	row, err := db.GetIntentByID(ctx, r.DB, iid, uid)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fmt.Errorf("intent not found")
	}
	return intentToModel(row), nil
}

func (r *queryResolver) IntentExecutions(ctx context.Context, intentID *string, first *int, after *string) (*model.IntentExecutionConnection, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	limit := 20
	if first != nil && *first > 0 {
		limit = *first
	}
	offset := 0
	if after != nil && *after != "" {
		offset, _ = strconv.Atoi(*after)
	}

	var iid *int64
	if intentID != nil && *intentID != "" {
		parsed, _ := strconv.ParseInt(*intentID, 10, 64)
		iid = &parsed
	}

	rows, total, err := db.GetIntentExecutions(ctx, r.DB, uid, iid, limit, offset)
	if err != nil {
		return nil, err
	}

	items := make([]*model.IntentExecution, len(rows))
	for i, row := range rows {
		items[i] = &model.IntentExecution{
			ID:                 strconv.FormatInt(row.ID, 10),
			IntentID:           strconv.FormatInt(row.IntentID, 10),
			Status:             model.IntentExecutionStatus(row.Status),
			TriggerType:        model.IntentTriggerType(row.TriggerType),
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
			items[i].Intent = &model.Intent{
				ID:   strconv.FormatInt(row.IntentID, 10),
				Name: row.IntentName.String,
			}
		}
	}

	return &model.IntentExecutionConnection{
		Items:      items,
		TotalCount: total,
		PageInfo:   buildPageInfo(len(items), total, limit, offset),
	}, nil
}

func (r *queryResolver) PreviewIntent(ctx context.Context, id string) (*model.IntentPreview, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	iid, _ := strconv.ParseInt(id, 10, 64)

	intent, err := db.GetIntentByID(ctx, r.DB, iid, uid)
	if err != nil || intent == nil {
		return nil, fmt.Errorf("intent not found")
	}

	matchC := db.UnmarshalStringArr(intent.MatchContainers)
	matchI := db.UnmarshalStringArr(intent.MatchImages)
	matchS := db.UnmarshalStringArr(intent.MatchSources)
	matchSt := db.UnmarshalStringArr(intent.MatchStacks)
	exC := db.UnmarshalStringArr(intent.ExcludeContainers)
	exI := db.UnmarshalStringArr(intent.ExcludeImages)
	exSt := db.UnmarshalStringArr(intent.ExcludeStacks)

	matched, total, err := db.GetContainersMatchingIntent(ctx, r.DB, uid,
		matchC, matchI, matchS, matchSt, nil, exC, exI, exSt, nil, 50, 0)
	if err != nil {
		return nil, err
	}

	containers := make([]*model.Container, len(matched))
	for i := range matched {
		containers[i] = containerRowToModel(&matched[i])
	}

	// Count excluded
	allContainers, allTotal, _ := db.GetContainersPaginated(ctx, r.DB, uid, 1000, 0)
	_ = allContainers
	excludedCount := allTotal - total

	return &model.IntentPreview{
		IntentID: id,
		MatchedContainers: &model.ContainerConnection{
			Items:      containers,
			TotalCount: total,
			PageInfo:   buildPageInfo(len(containers), total, 50, 0),
		},
		MatchedCount:  total,
		ExcludedCount: excludedCount,
	}, nil
}

func (r *queryResolver) BatchConfigs(ctx context.Context) ([]*model.BatchConfig, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := db.GetBatchConfigs(ctx, r.DB, uid)
	if err != nil {
		return nil, err
	}
	result := make([]*model.BatchConfig, len(rows))
	for i, row := range rows {
		result[i] = batchConfigToModel(&row)
	}
	return result, nil
}

func (r *queryResolver) BatchRuns(ctx context.Context, jobType *model.BatchJobType, first *int, after *string) (*model.BatchRunConnection, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	limit := 20
	if first != nil && *first > 0 {
		limit = *first
	}
	offset := 0
	if after != nil && *after != "" {
		offset, _ = strconv.Atoi(*after)
	}

	var jt *string
	if jobType != nil {
		s := string(*jobType)
		jt = &s
	}

	rows, total, err := db.GetBatchRuns(ctx, r.DB, uid, jt, limit, offset)
	if err != nil {
		return nil, err
	}

	items := make([]*model.BatchRun, len(rows))
	for i, row := range rows {
		items[i] = batchRunToModel(&row)
	}

	return &model.BatchRunConnection{
		Items:      items,
		TotalCount: total,
		PageInfo:   buildPageInfo(len(items), total, limit, offset),
	}, nil
}

func (r *queryResolver) BatchRun(ctx context.Context, id string) (*model.BatchRun, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	bid, _ := strconv.ParseInt(id, 10, 64)

	row, err := db.GetBatchRunByID(ctx, r.DB, bid, uid)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fmt.Errorf("batch run not found")
	}
	return batchRunToModel(row), nil
}

func (r *queryResolver) UpgradeHistory(ctx context.Context, filter *model.UpgradeHistoryFilterInput, first *int, after *string) (*model.UpgradeRecordConnection, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	limit := 50
	if first != nil && *first > 0 {
		limit = *first
	}
	offset := 0
	if after != nil && *after != "" {
		offset, _ = strconv.Atoi(*after)
	}

	rows, total, err := db.GetUpgradeHistory(ctx, r.DB, uid, limit, offset)
	if err != nil {
		return nil, err
	}

	items := make([]*model.UpgradeRecord, len(rows))
	for i, row := range rows {
		items[i] = upgradeRecordToModel(&row)
	}

	return &model.UpgradeRecordConnection{
		Items:      items,
		TotalCount: total,
		PageInfo:   buildPageInfo(len(items), total, limit, offset),
	}, nil
}

func (r *queryResolver) DiscordWebhooks(ctx context.Context) ([]*model.DiscordWebhook, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := db.GetDiscordWebhooks(ctx, r.DB, uid)
	if err != nil {
		return nil, err
	}
	result := make([]*model.DiscordWebhook, len(rows))
	for i, row := range rows {
		result[i] = discordWebhookToModel(&row)
	}
	return result, nil
}

func (r *queryResolver) DiscordWebhook(ctx context.Context, id string) (*model.DiscordWebhook, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	wid, _ := strconv.ParseInt(id, 10, 64)

	row, err := db.GetDiscordWebhookByID(ctx, r.DB, wid, uid)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fmt.Errorf("webhook not found")
	}
	return discordWebhookToModel(row), nil
}

func (r *queryResolver) RepositoryTokens(ctx context.Context) ([]*model.RepositoryAccessToken, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	rows, err := db.GetRepositoryTokens(ctx, r.DB, uid)
	if err != nil {
		return nil, err
	}

	result := make([]*model.RepositoryAccessToken, len(rows))
	for i, row := range rows {
		result[i] = repoTokenToModel(&row)
	}
	return result, nil
}

func (r *queryResolver) RepositoryToken(ctx context.Context, provider string) (*model.RepositoryAccessToken, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	row, err := db.GetRepositoryTokenByProvider(ctx, r.DB, uid, provider)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fmt.Errorf("repository token not found for provider: %s", provider)
	}
	return repoTokenToModel(row), nil
}

func (r *queryResolver) UserPreferences(ctx context.Context) (*model.UserPreferences, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	row, err := db.GetUserSettings(ctx, r.DB, uid)
	if err != nil {
		return nil, err
	}
	return &model.UserPreferences{
		ColorScheme:              row.ColorScheme,
		DisablePortainerPage:     row.DisablePortainerPage == 1,
		DisableTrackedAppsPage:   row.DisableTrackedAppsPage == 1,
		RefreshingTogglesEnabled: row.RefreshingToggles == 1,
	}, nil
}

func (r *queryResolver) OauthProviders(ctx context.Context) ([]*model.OAuthProvider, error) {
	return []*model.OAuthProvider{}, nil
}

func (r *queryResolver) Logs(ctx context.Context, lines *int, since *int, file *string) (*model.LogResult, error) {
	_, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	dataDir := getDataDir()
	logFile := dataDir + "/logs/out.log"
	if file != nil && *file != "" {
		logFile = dataDir + "/logs/" + *file
	}

	maxLines := 100
	if lines != nil && *lines > 0 {
		maxLines = *lines
	}

	data, err := os.ReadFile(logFile)
	if err != nil {
		return &model.LogResult{Logs: "", TotalLines: 0, ReturnedLines: 0, NewLines: 0}, nil
	}

	allLines := strings.Split(string(data), "\n")
	total := len(allLines)

	start := total - maxLines
	if start < 0 {
		start = 0
	}
	returned := allLines[start:]

	return &model.LogResult{
		Logs:          strings.Join(returned, "\n"),
		TotalLines:    total,
		ReturnedLines: len(returned),
		NewLines:      len(returned),
	}, nil
}

func (r *queryResolver) Operation(ctx context.Context, id string) (*model.Operation, error) {
	_, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	// Operations are ephemeral (no persistent table). Return not found for completed ops.
	return nil, fmt.Errorf("operation not found or already completed")
}

func (r *queryResolver) SummaryStats(ctx context.Context) (*model.SummaryStats, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}

	var totalContainers, totalSources, totalRunners, totalTrackedApps int
	r.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM containers WHERE user_id = ?", uid).Scan(&totalContainers)
	r.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM source_instances WHERE user_id = ?", uid).Scan(&totalSources)
	r.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM runners WHERE user_id = ?", uid).Scan(&totalRunners)
	r.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM tracked_apps WHERE user_id = ?", uid).Scan(&totalTrackedApps)

	// containersWithUpdates: compare deployed digest vs latest digest
	var withUpdates int
	r.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM containers c
		JOIN deployed_images di ON c.deployed_image_id = di.id
		JOIN registry_image_versions riv ON di.user_id = riv.user_id AND di.image_repo = riv.image_repo
		WHERE c.user_id = ? AND riv.latest_digest IS NOT NULL AND di.image_digest IS NOT NULL AND riv.latest_digest != di.image_digest`, uid).Scan(&withUpdates)

	// trackedAppsWithUpdates
	var trackedWithUpdates int
	r.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM tracked_apps WHERE user_id = ? AND has_update = 1", uid).Scan(&trackedWithUpdates)

	// unusedImagesCount
	unusedImages, _ := db.GetUnusedImages(ctx, r.DB, uid)

	return &model.SummaryStats{
		TotalContainers:        totalContainers,
		ContainersWithUpdates:  withUpdates,
		TotalSources:           totalSources,
		TotalRunners:           totalRunners,
		TotalTrackedApps:       totalTrackedApps,
		TrackedAppsWithUpdates: trackedWithUpdates,
		UnusedImagesCount:      len(unusedImages),
	}, nil
}

// ---------------------------------------------------------------------------
// Subscription resolvers
// ---------------------------------------------------------------------------

func (r *subscriptionResolver) ContainersUpdated(ctx context.Context) (<-chan *model.ContainersUpdatedEvent, error) {
	_, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	ch := make(chan *model.ContainersUpdatedEvent, 1)
	<-ctx.Done()
	return ch, nil
}

func (r *subscriptionResolver) ContainerUpgradeProgress(ctx context.Context) (<-chan *model.UpgradeProgressEvent, error) {
	_, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	ch := make(chan *model.UpgradeProgressEvent, 1)
	<-ctx.Done()
	return ch, nil
}

func (r *subscriptionResolver) BatchJobProgress(ctx context.Context) (<-chan *model.BatchRun, error) {
	_, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	ch := make(chan *model.BatchRun, 1)
	<-ctx.Done()
	return ch, nil
}

func (r *subscriptionResolver) IntentExecutionProgress(ctx context.Context) (<-chan *model.IntentExecution, error) {
	_, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	ch := make(chan *model.IntentExecution, 1)
	<-ctx.Done()
	return ch, nil
}

func (r *subscriptionResolver) RunnerStatusChanged(ctx context.Context) (<-chan *model.RunnerStatusEvent, error) {
	_, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	ch := make(chan *model.RunnerStatusEvent, 1)
	<-ctx.Done()
	return ch, nil
}

func (r *subscriptionResolver) OperationProgress(ctx context.Context) (<-chan *model.Operation, error) {
	_, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	ch := make(chan *model.Operation, 1)
	<-ctx.Done()
	return ch, nil
}

// ---------------------------------------------------------------------------
// Mutation returns MutationResolver implementation.
// ---------------------------------------------------------------------------
func (r *Resolver) Mutation() MutationResolver { return &mutationResolver{r} }

// Query returns QueryResolver implementation.
func (r *Resolver) Query() QueryResolver { return &queryResolver{r} }

// Subscription returns SubscriptionResolver implementation.
func (r *Resolver) Subscription() SubscriptionResolver { return &subscriptionResolver{r} }

type (
	mutationResolver     struct{ *Resolver }
	queryResolver        struct{ *Resolver }
	subscriptionResolver struct{ *Resolver }
)

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

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
	return &model.UpgradeRecord{
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

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

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
		ID:        strconv.FormatInt(t.ID, 10),
		Provider:  t.Provider,
		MaskedToken: masked,
		CreatedAt: parseTime(t.CreatedAt),
		UpdatedAt: parseTime(t.UpdatedAt),
	}
}

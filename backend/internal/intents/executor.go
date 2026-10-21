// Intent executor — port of Node's services/intents/intentExecutor.js.
// Matches containers, records the execution, then upgrades with stack-aware
// concurrency: sequential within a stack, parallel across stacks. Per-container
// results land in intent_execution_containers; upgrades are guarded by the
// shared SQLite upgrade lock with a 60s heartbeat.

package intents

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/dockedapp/backend/internal/db"
)

// UpgradeFunc performs the actual container upgrade (wired to the graph
// package's runner upgrade pipeline + upgrade-history recording).
type UpgradeFunc func(ctx context.Context, userID int64, c *db.ContainerRow, rr *db.RunnerRow, imageName string) error

// ContainerResult is one per-container outcome (Node's containerResults entry).
type ContainerResult struct {
	ContainerID   string
	ContainerName string
	ImageName     string
	Status        string // upgraded | failed | skipped | dry_run
	OldImage      *string
	NewImage      *string
	ErrorMessage  *string
	DurationMs    *int64
}

// Summary is the execution result returned to callers (Node's executeIntent result).
type Summary struct {
	ExecutionID        int64
	IntentName         string
	TriggerType        string
	Status             string
	ContainersMatched  int
	ContainersUpgraded int
	ContainersFailed   int
	ContainersSkipped  int
	DurationMs         int64
	Containers         []ContainerResult
}

// ExecOptions mirrors executeIntent's options. ExecutionID allows the manual
// trigger path to pre-create the 'pending' row (client needs the id
// synchronously) and have the executor adopt it.
type ExecOptions struct {
	TriggerType string
	TriggerTime *time.Time
	DryRun      *bool
	ExecutionID *int64
}

// Executor runs intents against the shared DB. Upgrade/Publish/Notify are
// injected so this package stays free of graph/hub dependencies.
type Executor struct {
	DB      *sql.DB
	Upgrade UpgradeFunc
	Publish func(ctx context.Context, userID, execID int64)
	Notify  func(ctx context.Context, userID int64, s Summary)
}

func (e *Executor) publish(ctx context.Context, userID, execID int64) {
	if e.Publish != nil {
		e.Publish(ctx, userID, execID)
	}
}

// ExecuteIntent matches containers and upgrades them, recording every step.
func (e *Executor) ExecuteIntent(ctx context.Context, intent *db.IntentRow, userID int64, opts ExecOptions) (*Summary, error) {
	triggerType := opts.TriggerType
	if triggerType == "" {
		triggerType = "manual"
	}
	isDryRun := intent.DryRun == 1
	if opts.DryRun != nil {
		isDryRun = *opts.DryRun
	}
	start := time.Now()

	var execID int64
	if opts.ExecutionID != nil {
		execID = *opts.ExecutionID
	}

	failExec := func(err error) (*Summary, error) {
		if execID != 0 {
			if uerr := db.MarkIntentExecutionFailed(ctx, e.DB, execID, err.Error()); uerr != nil {
				slog.Error("failed to update execution on error", "executionId", execID, "error", uerr)
			}
			e.publish(ctx, userID, execID)
		}
		slog.Error("intent execution failed", "intentId", intent.ID, "executionId", execID, "error", err)
		return nil, err
	}

	// Step 1: match containers (live runner + DB).
	out, err := FindMatchingContainers(ctx, e.DB, intent, userID, true, false)
	if err != nil {
		return failExec(err)
	}

	// Step 2: execution record ('running' unless the caller pre-created one).
	if execID == 0 {
		execID, err = db.CreateIntentExecutionStatus(ctx, e.DB, intent.ID, userID, triggerType, "running")
		if err != nil {
			return failExec(err)
		}
		e.publish(ctx, userID, execID)
	}

	// No matches — complete immediately.
	if len(out.Matched) == 0 {
		if err := db.UpdateIntentExecution(ctx, e.DB, execID, "completed", 0, 0, 0, 0, nil); err != nil {
			return failExec(err)
		}
		e.publish(ctx, userID, execID)
		e.updateLastEvaluated(ctx, intent, userID, execID, opts.TriggerTime)
		return &Summary{ExecutionID: execID, IntentName: intent.Name, TriggerType: triggerType,
			Status: "completed", DurationMs: time.Since(start).Milliseconds()}, nil
	}

	// Dry run — record matches, upgrade nothing.
	if isDryRun {
		results := make([]ContainerResult, 0, len(out.Matched))
		for i := range out.Matched {
			c := out.Matched[i]
			oldImg := c.ImageName.String
			_ = db.InsertIntentExecutionContainer(ctx, e.DB, db.IntentExecContainerInsert{
				ExecutionID:      execID,
				ContainerID:      c.ContainerID,
				ContainerName:    c.ContainerName,
				ImageName:        c.ImageName.String,
				SourceInstanceID: nullInt64Ptr(c.SourceInstanceID),
				RunnerID:         nullInt64Ptr(c.RunnerID),
				Status:           "dry_run",
				OldImage:         &oldImg,
			})
			results = append(results, ContainerResult{
				ContainerID: c.ContainerID, ContainerName: c.ContainerName,
				ImageName: c.ImageName.String, Status: "dry_run", OldImage: &oldImg,
			})
		}
		matched := len(out.Matched)
		if err := db.UpdateIntentExecution(ctx, e.DB, execID, "completed", matched, 0, 0, matched, nil); err != nil {
			return failExec(err)
		}
		e.publish(ctx, userID, execID)
		e.updateLastEvaluated(ctx, intent, userID, execID, opts.TriggerTime)
		return &Summary{
			ExecutionID: execID, IntentName: intent.Name, TriggerType: triggerType,
			Status:            "completed",
			ContainersMatched: matched, ContainersSkipped: matched,
			DurationMs: time.Since(start).Milliseconds(), Containers: results,
		}, nil
	}

	// Step 4: stack-aware concurrency — sequential within a stack, parallel
	// across stacks (standalone containers each get their own group), with
	// the intent's max_concurrent capping how many groups run at once and
	// sequential_delay_sec pacing upgrades within a group. (Node stored both
	// columns but never enforced them; the contract says they should apply.)
	type group struct {
		containers []db.ContainerRow
		results    []ContainerResult
		err        error
	}
	groups := make([]*group, 0)
	index := make(map[string]*group)
	standalone := 0
	for i := range out.Matched {
		c := out.Matched[i]
		key := c.StackName.String
		if key == "" {
			key = fmt.Sprintf("__standalone_%d", standalone)
			standalone++
		}
		g, ok := index[key]
		if !ok {
			g = &group{}
			index[key] = g
			groups = append(groups, g)
		}
		g.containers = append(g.containers, c)
	}

	slog.Info("intent executor: grouped containers by stack",
		"intentId", intent.ID, "totalContainers", len(out.Matched), "stackGroups", len(groups))

	maxConcurrent := intent.MaxConcurrent
	if maxConcurrent < 1 {
		maxConcurrent = 1
	}
	seqDelay := time.Duration(intent.SequentialDelaySec) * time.Second
	if seqDelay < 0 {
		seqDelay = 0
	}

	var wg sync.WaitGroup
	sem := make(chan struct{}, maxConcurrent)
	for _, g := range groups {
		wg.Add(1)
		go func(g *group) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			for i := range g.containers {
				res, err := e.upgradeContainer(ctx, &g.containers[i], userID, execID, intent.ID)
				if err != nil {
					g.err = err
					return
				}
				g.results = append(g.results, res)
				if seqDelay > 0 && i < len(g.containers)-1 {
					select {
					case <-time.After(seqDelay):
					case <-ctx.Done():
						g.err = ctx.Err()
						return
					}
				}
			}
		}(g)
	}
	wg.Wait()

	for _, g := range groups {
		if g.err != nil {
			return failExec(g.err)
		}
	}

	var results []ContainerResult
	upgraded, failed, skipped := 0, 0, 0
	for _, g := range groups {
		for _, res := range g.results {
			results = append(results, res)
			switch res.Status {
			case "upgraded":
				upgraded++
			case "skipped":
				skipped++
			default:
				failed++
			}
		}
	}

	// Step 5: final totals.
	finalStatus := "completed"
	if failed != 0 {
		if upgraded == 0 {
			finalStatus = "failed"
		} else {
			finalStatus = "partial"
		}
	}
	matched := len(out.Matched)
	if err := db.UpdateIntentExecution(ctx, e.DB, execID, finalStatus, matched, upgraded, failed, skipped, nil); err != nil {
		return failExec(err)
	}
	e.publish(ctx, userID, execID)
	e.updateLastEvaluated(ctx, intent, userID, execID, opts.TriggerTime)

	slog.Info("intent execution complete",
		"intentId", intent.ID, "intentName", intent.Name, "executionId", execID,
		"status", finalStatus, "matched", matched, "upgraded", upgraded,
		"failed", failed, "skipped", skipped)

	summary := &Summary{
		ExecutionID: execID, IntentName: intent.Name, TriggerType: triggerType,
		Status:            finalStatus,
		ContainersMatched: matched, ContainersUpgraded: upgraded,
		ContainersFailed: failed, ContainersSkipped: skipped,
		DurationMs: time.Since(start).Milliseconds(), Containers: results,
	}

	// Discord notification for real executions only (best-effort).
	if !isDryRun && e.Notify != nil {
		func() {
			defer func() {
				if rec := recover(); rec != nil {
					slog.Error("panic in intent notification", "recover", rec)
				}
			}()
			e.Notify(ctx, userID, *summary)
		}()
	}
	return summary, nil
}

// upgradeContainer locks, upgrades, and records one container. Only lock
// acquisition errors abort the execution (Node parity); upgrade and record
// errors are captured per-container.
func (e *Executor) upgradeContainer(ctx context.Context, c *db.ContainerRow, userID, execID, intentID int64) (ContainerResult, error) {
	startTime := time.Now()
	lockKey := containerLockKey(c)
	displayOwner := fmt.Sprintf("intent:%d", intentID)
	token := displayOwner + ":" + randHexToken()

	acquired, err := db.AcquireUpgradeLock(ctx, e.DB, lockKey, token)
	if err != nil {
		return ContainerResult{}, err
	}
	if !acquired {
		owner := "unknown"
		if o, found, oerr := db.GetActiveUpgradeLockOwner(ctx, e.DB, lockKey); oerr == nil && found {
			owner = displayLockOwner(o)
		}
		slog.Info("container upgrade skipped — already locked",
			"containerId", c.ContainerID, "containerName", c.ContainerName,
			"lockedBy", owner, "intentId", intentID)

		msg := fmt.Sprintf("Upgrade already in progress (locked by %s)", owner)
		_ = e.recordContainer(ctx, execID, c, db.IntentExecContainerInsert{
			Status:       "skipped",
			OldImage:     strPtr(c.ImageName.String),
			ErrorMessage: &msg,
		})
		return ContainerResult{
			ContainerID: c.ContainerID, ContainerName: c.ContainerName,
			ImageName: c.ImageName.String, Status: "skipped", ErrorMessage: &msg,
		}, nil
	}

	// Heartbeat: extend the lease every 60s while the upgrade runs (Node's
	// upgradeLockManager heartbeat).
	stopHeartbeat := make(chan struct{})
	defer close(stopHeartbeat)
	hbDone := make(chan struct{})
	go func() {
		defer close(hbDone)
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopHeartbeat:
				return
			case <-ticker.C:
				if err := db.RefreshUpgradeLock(ctx, e.DB, lockKey, token); err != nil {
					slog.Debug("upgrade lock heartbeat failed", "lockKey", lockKey, "error", err)
				}
			}
		}
	}()
	defer func() {
		if err := db.ReleaseUpgradeLock(ctx, e.DB, lockKey, token); err != nil {
			slog.Warn("upgrade lock release failed", "lockKey", lockKey, "error", err)
		}
	}()

	var rr *db.RunnerRow
	if c.RunnerID.Valid {
		rr, err = db.GetRunnerByID(ctx, e.DB, c.RunnerID.Int64, userID)
		if err != nil {
			rr = nil
		}
	}
	if rr == nil || strings.TrimSpace(rr.URL) == "" {
		msg := "Runner not found for container"
		duration := time.Since(startTime).Milliseconds()
		_ = e.recordContainer(ctx, execID, c, db.IntentExecContainerInsert{
			Status:       "failed",
			OldImage:     strPtr(c.ImageName.String),
			ErrorMessage: &msg,
			DurationMs:   &duration,
		})
		return ContainerResult{
			ContainerID: c.ContainerID, ContainerName: c.ContainerName,
			ImageName: c.ImageName.String, Status: "failed", ErrorMessage: &msg, DurationMs: &duration,
		}, nil
	}

	upgradeCtx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	if err := e.Upgrade(upgradeCtx, userID, c, rr, c.ImageName.String); err != nil {
		duration := time.Since(startTime).Milliseconds()
		slog.Error("container upgrade failed during intent execution",
			"containerId", c.ContainerID, "containerName", c.ContainerName, "error", err)
		errMsg := err.Error()
		_ = e.recordContainer(ctx, execID, c, db.IntentExecContainerInsert{
			Status:       "failed",
			OldImage:     strPtr(c.ImageName.String),
			ErrorMessage: &errMsg,
			DurationMs:   &duration,
		})
		return ContainerResult{
			ContainerID: c.ContainerID, ContainerName: c.ContainerName,
			ImageName: c.ImageName.String, Status: "failed", ErrorMessage: strPtr(err.Error()), DurationMs: &duration,
		}, nil
	}

	duration := time.Since(startTime).Milliseconds()
	oldImg := c.ImageName.String
	newImg := c.ImageName.String
	oldDigest := c.CurrentDigest.String
	// Node records newDigest as null: the upgrade response doesn't carry it.
	_ = e.recordContainer(ctx, execID, c, db.IntentExecContainerInsert{
		Status:     "upgraded",
		OldImage:   &oldImg,
		NewImage:   &newImg,
		OldDigest:  strPtr(oldDigest),
		DurationMs: &duration,
	})
	return ContainerResult{
		ContainerID: c.ContainerID, ContainerName: c.ContainerName,
		ImageName: c.ImageName.String, Status: "upgraded", OldImage: &oldImg, NewImage: &newImg, DurationMs: &duration,
	}, nil
}

// recordContainer fills the identity fields and writes the result row.
func (e *Executor) recordContainer(ctx context.Context, execID int64, c *db.ContainerRow, in db.IntentExecContainerInsert) error {
	in.ExecutionID = execID
	in.ContainerID = c.ContainerID
	in.ContainerName = c.ContainerName
	in.ImageName = c.ImageName.String
	in.SourceInstanceID = nullInt64Ptr(c.SourceInstanceID)
	in.RunnerID = nullInt64Ptr(c.RunnerID)
	return db.InsertIntentExecutionContainer(ctx, e.DB, in)
}

// updateLastEvaluated anchors last_evaluated_at to the cron trigger point
// (never wall-clock for scheduled runs) and records the execution id.
func (e *Executor) updateLastEvaluated(ctx context.Context, intent *db.IntentRow, userID, execID int64, triggerTime *time.Time) {
	evaluatedAt := time.Now().UTC().Format(isoMillis)
	if triggerTime != nil {
		evaluatedAt = triggerTime.UTC().Format(isoMillis)
	}
	if err := db.SetIntentLastEvaluatedAt(ctx, e.DB, intent.ID, userID, evaluatedAt, execID); err != nil {
		slog.Error("failed to update intent lastEvaluatedAt", "intentId", intent.ID, "error", err)
	}
}

// containerLockKey mirrors upgradeLockManager._key's typed prefixes.
func containerLockKey(c *db.ContainerRow) string {
	if c.SourceInstanceID.Valid {
		return fmt.Sprintf("source:%d:%s", c.SourceInstanceID.Int64, c.ContainerID)
	}
	if c.RunnerID.Valid {
		return fmt.Sprintf("runner:%d:%s", c.RunnerID.Int64, c.ContainerID)
	}
	return c.ContainerID
}

// randHexToken builds the unique half of a lock token (Node uses a UUID).
func randHexToken() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// displayLockOwner strips the random token suffix so skip reasons show the
// human-readable owner ("intent:42") like Node's local lock map does.
func displayLockOwner(token string) string {
	if i := strings.LastIndex(token, ":"); i > 0 && len(token)-i-1 == 16 {
		if _, err := hex.DecodeString(token[i+1:]); err == nil {
			return token[:i]
		}
	}
	return token
}

func nullInt64Ptr(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	return &v.Int64
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

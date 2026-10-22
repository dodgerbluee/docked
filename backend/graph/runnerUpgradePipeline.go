package graph

// Runner container upgrade orchestration — a faithful port of Node's
// containerUpgradeService.upgradeSingleContainer and its helper services
// (containerConfigService, containerReadinessService, dependentContainerService,
// dependentContainerRestartService). The runner exposes fine-grained Docker
// Engine endpoints; the orchestration (stop dependents → stop → pull → remove →
// recreate → start → readiness → restart dependents) lives here, NOT on the
// runner.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/runner"
)

// ── Decoded-JSON access helpers ─────────────────────────────────────────────

// startLockHeartbeat extends a held upgrade lock every 60s until the
// returned stop func is called. Node's lock manager heartbeats on the same
// cadence (see the runnerUser SSE proxy's refresh loop); without it the
// ten-minute lease expires mid-pipeline — upgrades get a fifteen-minute
// budget — and a second upgrade could then start against the same
// container while the first is still recreating it.
func (r *Resolver) startLockHeartbeat(targetKey, owner string) (stop func()) {
	done := make(chan struct{})
	var once sync.Once
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := db.RefreshUpgradeLock(context.Background(), r.DB, targetKey, owner); err != nil {
					slog.Warn("upgrade lock refresh failed", "target", targetKey, "error", err.Error())
				}
			case <-done:
				return
			}
		}
	}()
	return func() { once.Do(func() { close(done) }) }
}

// jObj returns m[key] when it is a JSON object, nil otherwise. Indexing a nil
// map is safe in Go, so callers may chain jObj(jObj(m, "State"), "Health").
func jObj(m map[string]any, key string) map[string]any {
	if v, ok := m[key].(map[string]any); ok {
		return v
	}
	return nil
}

// jStr returns m[key] when it is a JSON string, "" otherwise.
func jStr(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

// jsTruthy approximates JavaScript truthiness for decoded JSON values:
// null, false, 0 and "" are falsy; arrays and objects (even empty ones) are
// truthy. Needed to mirror Node's `x || undefined` / `x || []` semantics.
func jsTruthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case float64:
		return t != 0
	case string:
		return t != ""
	default:
		return true
	}
}

// ── Container state helpers ─────────────────────────────────────────────────

// inspectStatus mirrors Node's `details.State?.Status || (Running ? "running" : "unknown")`.
func inspectStatus(details map[string]any) string {
	state := jObj(details, "State")
	if state == nil {
		return "unknown"
	}
	if s := jStr(state, "Status"); s != "" {
		return s
	}
	if running, _ := state["Running"].(bool); running {
		return "running"
	}
	return "unknown"
}

func inspectRunning(details map[string]any) bool {
	state := jObj(details, "State")
	if state == nil {
		return false
	}
	if jStr(state, "Status") == "running" {
		return true
	}
	running, _ := state["Running"].(bool)
	return running
}

// inspectStopped mirrors the readiness service's default: missing State counts
// as not stopped, missing Status with Running===false counts as "exited".
func inspectStopped(details map[string]any) bool {
	state := jObj(details, "State")
	if state == nil {
		return false
	}
	s := jStr(state, "Status")
	if s == "" {
		if r, ok := state["Running"].(bool); ok && !r {
			s = "exited"
		} else {
			s = "unknown"
		}
	}
	return s == "exited" || s == "stopped"
}

// restartStatus mirrors the dependent-restart services' default: missing State
// or Running===false counts as "exited".
func restartStatus(details map[string]any) string {
	state := jObj(details, "State")
	if state == nil {
		return "exited"
	}
	if s := jStr(state, "Status"); s != "" {
		return s
	}
	if running, _ := state["Running"].(bool); running {
		return "running"
	}
	return "exited"
}

// networkModeRef extracts the referenced container from a NetworkMode string
// ("service:foo" / "container:foo"); "" means not a shared network mode.
func networkModeRef(networkMode string) string {
	if rest, ok := strings.CutPrefix(networkMode, "service:"); ok {
		return rest
	}
	if rest, ok := strings.CutPrefix(networkMode, "container:"); ok {
		return rest
	}
	return ""
}

func isSharedNetworkMode(networkMode string) bool {
	return networkModeRef(networkMode) != ""
}

// ── Config preparation (containerConfigService port) ────────────────────────

// cleanHostConfigForCreate shallow-copies HostConfig and strips fields that
// must not appear in a create request.
func cleanHostConfigForCreate(hostConfig map[string]any, containerName string) (map[string]any, bool) {
	clean := make(map[string]any, len(hostConfig))
	for k, v := range hostConfig {
		clean[k] = v
	}
	// Container-specific file paths and Docker-managed bookkeeping.
	for _, k := range []string{
		"ContainerIDFile", "ResolvConfPath", "HostnamePath", "HostsPath",
		"Runtime", "RestartCount", "AutoRemove",
	} {
		delete(clean, k)
	}

	networkMode := jStr(clean, "NetworkMode")
	shared := isSharedNetworkMode(networkMode)
	if shared {
		// Ports are exposed on the network provider, not this container;
		// PortBindings would make the create request fail.
		if jsTruthy(clean["PortBindings"]) {
			log.Printf("upgrade %s: removing PortBindings (conflicts with shared network mode %s)", containerName, networkMode)
			delete(clean, "PortBindings")
		}
		if _, ok := clean["PublishAllPorts"]; ok {
			delete(clean, "PublishAllPorts")
		}
	}

	if rp, ok := clean["RestartPolicy"].(map[string]any); ok {
		if jStr(rp, "Name") == "" {
			clean["RestartPolicy"] = map[string]any{"Name": "no"}
		}
	}
	return clean, shared
}

// prepareNetworkingConfig converts NetworkSettings.Networks into the endpoint
// format the create API accepts. Containers on shared network modes have no
// network config of their own.
func prepareNetworkingConfig(details map[string]any, shared bool) map[string]any {
	if shared {
		return nil
	}
	networks := jObj(jObj(details, "NetworkSettings"), "Networks")
	if networks == nil {
		return nil
	}
	endpoints := map[string]any{}
	for name, raw := range networks {
		data, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		endpoint := map[string]any{}
		if jsTruthy(data["IPAMConfig"]) {
			endpoint["IPAMConfig"] = data["IPAMConfig"]
		}
		if jsTruthy(data["Links"]) {
			endpoint["Links"] = data["Links"]
		}
		if jsTruthy(data["Aliases"]) {
			endpoint["Aliases"] = data["Aliases"]
		}
		if len(endpoint) > 0 {
			endpoints[name] = endpoint
		}
	}
	if len(endpoints) == 0 {
		return nil
	}
	return map[string]any{"EndpointsConfig": endpoints}
}

// buildUpgradeConfig assembles the create payload for the upgraded container.
func buildUpgradeConfig(details map[string]any, newImage string, cleanHC, netCfg map[string]any, shared bool) map[string]any {
	config := jObj(details, "Config")
	out := map[string]any{"Image": newImage}
	if jsTruthy(config["Cmd"]) {
		out["Cmd"] = config["Cmd"]
	}
	if env, ok := config["Env"].([]any); ok {
		out["Env"] = env
	}
	// ExposedPorts conflict with shared network modes.
	if !shared {
		if ep, ok := config["ExposedPorts"].(map[string]any); ok && len(ep) > 0 {
			out["ExposedPorts"] = ep
		}
	}
	if len(cleanHC) > 0 {
		out["HostConfig"] = cleanHC
	}
	if labels, ok := config["Labels"].(map[string]any); ok && len(labels) > 0 {
		out["Labels"] = labels
	}
	if wd := jStr(config, "WorkingDir"); wd != "" {
		out["WorkingDir"] = wd
	}
	if jsTruthy(config["Entrypoint"]) {
		out["Entrypoint"] = config["Entrypoint"]
	}
	addPreservedConfigFields(out, config)
	if netCfg != nil {
		out["NetworkingConfig"] = netCfg
	}
	return out
}

// addPreservedConfigFields copies the Config fields that Docker's inspect
// returns but the original Node port failed to carry over, which silently
// stripped health checks, the run-as user, and stop behavior from every
// recreated container (State.Health, health-gated readiness, and the UI
// health badge all degrade after upgrade).
func addPreservedConfigFields(out, config map[string]any) {
	if user := jStr(config, "User"); user != "" {
		out["User"] = user
	}
	if hc, ok := config["Healthcheck"].(map[string]any); ok && len(hc) > 0 {
		out["Healthcheck"] = hc
	}
	if ss := jStr(config, "StopSignal"); ss != "" {
		out["StopSignal"] = ss
	}
	// Docker reports an explicit --stop-timeout 0 as the number 0 and an
	// unset one as null; keep the explicit zero (it means "use the default"
	// but was deliberately set) and skip only null.
	if st, ok := config["StopTimeout"].(float64); ok && st >= 0 {
		out["StopTimeout"] = int(st)
	}
	for _, b := range []string{"Tty", "OpenStdin", "StdinOnce"} {
		if v, ok := config[b].(bool); ok && v {
			out[b] = true
		}
	}
}

// prepareContainerConfig is the main config-prep entry point: cleaned
// HostConfig + NetworkingConfig + create payload, plus the shared-network flag
// and stack label.
func prepareContainerConfig(details map[string]any, newImage, containerName string) (map[string]any, bool, string) {
	labels := jObj(jObj(details, "Config"), "Labels")
	stackName := ""
	if labels != nil {
		stackName = jStr(labels, "com.docker.compose.project")
		if stackName == "" {
			stackName = jStr(labels, "com.docker.stack.namespace")
		}
	}
	cleanHC, shared := cleanHostConfigForCreate(jObj(details, "HostConfig"), containerName)
	preserveAnonymousVolumes(details, cleanHC)
	netCfg := prepareNetworkingConfig(details, shared)
	return buildUpgradeConfig(details, newImage, cleanHC, netCfg, shared), shared, stackName
}

// preserveAnonymousVolumes re-attaches image-declared anonymous volumes to a
// recreated container. Anonymous volumes show up in inspect Mounts (type
// "volume") but NOT in HostConfig.Binds; without re-adding them as explicit
// binds the recreate silently gets a brand-new empty volume and the old data
// is orphaned (databases that declare VOLUME /data lose everything on
// upgrade).
func preserveAnonymousVolumes(details map[string]any, cleanHC map[string]any) {
	mounts, _ := details["Mounts"].([]any)
	if len(mounts) == 0 {
		return
	}
	binds, _ := cleanHC["Binds"].([]any)
	covered := map[string]bool{}
	for _, b := range binds {
		s, ok := b.(string)
		if !ok {
			continue
		}
		// bind format src:dst[:mode]; named volumes appear here, anonymous
		// ones never do.
		if parts := strings.SplitN(s, ":", 3); len(parts) >= 2 {
			covered[parts[0]] = true
			covered[parts[1]] = true
		}
	}
	for _, m := range mounts {
		mm, ok := m.(map[string]any)
		if !ok || jStr(mm, "Type") != "volume" {
			continue
		}
		name, src, dst := jStr(mm, "Name"), jStr(mm, "Source"), jStr(mm, "Destination")
		// Re-attach by volume NAME: Source is the host path
		// (/var/lib/docker/volumes/<name>/_data), and binding that path
		// breaks on remote runners / non-default docker roots. A name bind
		// is what Docker itself round-trips.
		key := name
		if key == "" {
			key = src
		}
		if key == "" || dst == "" || covered[dst] || covered[key] || covered[src] {
			continue
		}
		bind := key + ":" + dst
		if mode := jStr(mm, "Mode"); mode != "" {
			bind += ":" + mode
		}
		binds = append(binds, bind)
		covered[dst] = true
	}
	if len(binds) > 0 {
		cleanHC["Binds"] = binds
	}
}

// ── Readiness (containerReadinessService port) ──────────────────────────────

var dbImageRe = regexp.MustCompile(`(?i)postgres|mysql|mariadb|redis|mongodb|couchdb|influxdb|elasticsearch`)

// waitForContainerStop polls until the container reports exited/stopped or the
// runner 404s (container gone). Timeout is non-fatal: the caller proceeds.
func waitForContainerStop(ctx context.Context, rr db.RunnerRow, containerID, containerName string) bool {
	for i := 0; i < 20; i++ { // 10s cap, 500ms interval
		if ctx.Err() != nil {
			return false
		}
		time.Sleep(500 * time.Millisecond)
		details, err := runner.InspectContainer(ctx, rr, containerID)
		if err != nil {
			var he *runner.HTTPError
			if errors.As(err, &he) && he.Code == 404 {
				return true
			}
			continue
		}
		if inspectStopped(details) {
			return true
		}
	}
	log.Printf("upgrade %s: container did not stop within timeout, proceeding anyway", containerName)
	return false
}

// readinessCheck evaluates one inspect sample. fatal errors (container exited,
// health check failed) abort the wait immediately, mirroring Node's
// message-based rethrow.
func readinessCheck(ctx context.Context, rr db.RunnerRow, details map[string]any, containerID, imageName string, waitTime time.Duration, consecutive, required int) (ready bool, fatal error) {
	if !inspectRunning(details) {
		if inspectStatus(details) == "exited" {
			exitCode := 0
			if state := jObj(details, "State"); state != nil {
				if c, ok := state["ExitCode"].(float64); ok {
					exitCode = int(c)
				}
			}
			logs, logErr := runner.GetContainerLogs(ctx, rr, containerID, 50)
			if logErr == nil {
				return false, fmt.Errorf("container exited with code %d. Last 50 lines of logs:\n%s", exitCode, logs)
			}
			return false, fmt.Errorf("container exited with code %d. Could not retrieve logs.", exitCode)
		}
		return false, nil
	}

	if health := jObj(jObj(details, "State"), "Health"); health != nil {
		switch jStr(health, "Status") {
		case "healthy":
			return true, nil
		case "unhealthy":
			logs, logErr := runner.GetContainerLogs(ctx, rr, containerID, 50)
			if logErr == nil {
				return false, fmt.Errorf("container health check failed. Last 50 lines of logs:\n%s", logs)
			}
			return false, fmt.Errorf("container health check failed. Could not retrieve logs.")
		default: // "starting" or "none"
			return waitTime >= 30*time.Second && consecutive >= 5, nil
		}
	}

	// No health check: stable-run heuristics. Databases get no early pass.
	if waitTime >= 15*time.Second && consecutive >= required {
		return true, nil
	}
	if waitTime >= 5*time.Second && consecutive >= 2 {
		return !dbImageRe.MatchString(imageName), nil
	}
	return false, nil
}

// waitForContainerReady polls the new container until it is healthy/stable.
func waitForContainerReady(ctx context.Context, rr db.RunnerRow, containerID, containerName, imageName string) error {
	const maxWait = 120 * time.Second
	const interval = 2 * time.Second
	const requiredStableChecks = 3

	start := time.Now()
	consecutive := 0
	for time.Since(start) < maxWait {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		time.Sleep(interval)
		details, err := runner.InspectContainer(ctx, rr, containerID)
		if err != nil {
			consecutive = 0
			continue
		}
		ready, fatal := readinessCheck(ctx, rr, details, containerID, imageName, time.Since(start), consecutive, requiredStableChecks)
		if fatal != nil {
			return fatal
		}
		if ready {
			return nil
		}
		consecutive++
	}

	// Final check: a running container at timeout still counts as ready.
	details, err := runner.InspectContainer(ctx, rr, containerID)
	if err == nil {
		if inspectRunning(details) {
			log.Printf("upgrade %s: readiness timeout reached but container is running, considering it ready", containerName)
			return nil
		}
		stateInfo := jStr(jObj(details, "State"), "Status")
		if stateInfo == "" {
			stateInfo = "unknown"
		}
		return fmt.Errorf("container did not become ready within timeout period (%s). Current state: %s", maxWait, stateInfo)
	}
	return fmt.Errorf("container did not become ready within timeout period (%s). Container may have failed to start.", maxWait)
}

// ── Pre-stop dependents (dependentContainerService port) ────────────────────

type depContainer struct {
	ID   string
	Name string
	// Details is the inspect document captured BEFORE the dependent was
	// removed; it is the only way back if the pipeline fails midway.
	Details map[string]any
}

// findDependentContainers lists containers whose network_mode references the
// target by name and which are currently running.
func findDependentContainers(ctx context.Context, rr db.RunnerRow, targetID, cleanName string) []depContainer {
	list, err := runner.FetchContainers(ctx, rr)
	if err != nil {
		log.Printf("upgrade: could not check for dependent containers before stopping, proceeding anyway: %v", err)
		return nil
	}
	var deps []depContainer
	for _, c := range list {
		if c.ID == targetID || cleanName == "" {
			continue
		}
		details, err := runner.InspectContainer(ctx, rr, c.ID)
		if err != nil {
			continue
		}
		nm := jStr(jObj(details, "HostConfig"), "NetworkMode")
		if networkModeRef(nm) == cleanName && restartStatus(details) == "running" {
			deps = append(deps, depContainer{ID: c.ID, Name: c.Name, Details: details})
		}
	}
	return deps
}

// stopAndRemoveDependentContainers removes (not just stops) dependents so
// compose does not auto-recreate them against the old provider container ID.
func stopAndRemoveDependentContainers(ctx context.Context, rr db.RunnerRow, deps []depContainer) {
	for _, d := range deps {
		if err := runner.StopContainer(ctx, rr, d.ID); err != nil {
			log.Printf("upgrade: dependent %s may already be stopped: %v", d.Name, err)
		}
		if err := runner.RemoveContainer(ctx, rr, d.ID, false); err != nil {
			log.Printf("upgrade: failed to remove dependent %s: %v", d.Name, err)
		}
	}
	time.Sleep(3 * time.Second)
}

// restoreRemovedDependents recreates up-front-removed dependents after the
// pipeline fails midway. Without this they are gone for good: their provider
// may already be removed too, and the post-upgrade restart path never runs
// on a failed pipeline. Best-effort: every step logs and continues.
func restoreRemovedDependents(ctx context.Context, rr db.RunnerRow, deps []depContainer, cleanName string, providerDetails map[string]any) {
	ctx = context.WithoutCancel(ctx)
	// Prefer the INSPECTED image ID (top-level Image): the pipeline may have
	// pulled the tag onto a new digest before failing, so recreating from
	// Config.Image could roll the provider FORWARD instead of back.
	originalImage := jStr(providerDetails, "Image")
	if originalImage == "" {
		originalImage = jStr(jObj(providerDetails, "Config"), "Image")
	}

	// Dependents reference the provider container; make sure one exists
	// under the original name (the pipeline may have failed after removing
	// it) and learn its current ID.
	providerID := ""
	if list, err := runner.FetchContainers(ctx, rr); err == nil {
		for _, c := range list {
			if strings.TrimPrefix(c.Name, "/") == cleanName {
				providerID = c.ID
				break
			}
		}
	}
	if providerID == "" {
		cfg, _, _ := prepareContainerConfig(providerDetails, originalImage, "/"+cleanName)
		id, err := runner.CreateContainer(ctx, rr, cfg, "/"+cleanName)
		if err != nil {
			log.Printf("upgrade rollback: could not recreate provider %s: %v", cleanName, err)
			return
		}
		providerID = id
		if err := runner.StartContainer(ctx, rr, providerID); err != nil {
			log.Printf("upgrade rollback: provider %s recreated but failed to start: %v", cleanName, err)
		}
	} else if details, err := runner.InspectContainer(ctx, rr, providerID); err == nil && restartStatus(details) != "running" {
		// The pipeline stopped the provider before failing (pull/remove
		// path): dependents recreated with network_mode:container:<id>
		// cannot start against a stopped provider, so bring it back up.
		if err := runner.StartContainer(ctx, rr, providerID); err != nil {
			log.Printf("upgrade rollback: provider %s exists but failed to start: %v", cleanName, err)
		}
	}

	for _, d := range deps {
		if d.Details == nil {
			log.Printf("upgrade rollback: no snapshot for dependent %s, cannot restore", d.Name)
			continue
		}
		if err := recreateNetworkModeContainer(ctx, rr, depAfter{ID: d.ID, Name: d.Name}, d.Details, providerID); err != nil {
			log.Printf("upgrade rollback: could not recreate dependent %s: %v", d.Name, err)
		}
	}
}

// ── Post-upgrade dependents (dependentContainerRestartService port) ─────────

type depAfter struct {
	ID      string
	Name    string
	Running bool
	Stopped bool
	Reason  string // "network_mode" or "stack"
}

var fullIDRe = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)

// networkModeMatches matches a dependent's network_mode reference against the
// upgraded container by name, old ID, or new ID.
func networkModeMatches(networkMode, cleanName, originalID, newID string) bool {
	ref := networkModeRef(networkMode)
	if ref == "" {
		return false
	}
	if ref == cleanName {
		return true
	}
	if len(ref) == 64 && fullIDRe.MatchString(ref) && (ref == originalID || ref == newID) {
		return true
	}
	return false
}

func findDependentContainersAfterUpgrade(ctx context.Context, rr db.RunnerRow, newID, cleanName, originalID, stackName string) ([]depAfter, error) {
	list, err := runner.FetchContainers(ctx, rr)
	if err != nil {
		return nil, err
	}
	var out []depAfter
	for _, c := range list {
		if c.ID == newID {
			continue
		}
		details, err := runner.InspectContainer(ctx, rr, c.ID)
		if err != nil {
			continue
		}
		status := restartStatus(details)
		running := status == "running"
		stopped := status == "exited" || status == "stopped"

		nm := jStr(jObj(details, "HostConfig"), "NetworkMode")
		if networkModeMatches(nm, cleanName, originalID, newID) {
			out = append(out, depAfter{ID: c.ID, Name: c.Name, Running: running, Stopped: stopped, Reason: "network_mode"})
			continue
		}
		if stackName != "" {
			labels := jObj(jObj(details, "Config"), "Labels")
			stack := ""
			if labels != nil {
				stack = jStr(labels, "com.docker.compose.project")
				if stack == "" {
					stack = jStr(labels, "com.docker.stack.namespace")
				}
			}
			if stack == stackName && (running || stopped) {
				out = append(out, depAfter{ID: c.ID, Name: c.Name, Running: running, Stopped: stopped, Reason: "stack"})
			}
		}
	}
	return out, nil
}

// waitForUpgradedContainerHealth gives a starting health check a grace window
// before dependents are recreated. Never fatal.
func waitForUpgradedContainerHealth(ctx context.Context, rr db.RunnerRow, newID string) {
	details, err := runner.InspectContainer(ctx, rr, newID)
	if err != nil {
		time.Sleep(2 * time.Second)
		return
	}
	health := jObj(jObj(details, "State"), "Health")
	if health == nil {
		time.Sleep(2 * time.Second)
		return
	}
	switch jStr(health, "Status") {
	case "starting", "none":
		for i := 0; i < 15; i++ { // 30s cap
			time.Sleep(2 * time.Second)
			cur, err := runner.InspectContainer(ctx, rr, newID)
			if err != nil {
				time.Sleep(2 * time.Second)
				return
			}
			if jStr(jObj(jObj(cur, "State"), "Health"), "Status") == "healthy" {
				return
			}
		}
		log.Printf("upgrade: upgraded container health check not ready, proceeding with dependent restarts")
	}
}

// verifyUpgradedContainer confirms the new container is running before
// dependents are recreated against it.
func verifyUpgradedContainer(ctx context.Context, rr db.RunnerRow, newID, cleanName string) error {
	details, err := runner.InspectContainer(ctx, rr, newID)
	if err != nil {
		return fmt.Errorf("failed to verify network container %s: %w", cleanName, err)
	}
	verifiedName := strings.TrimPrefix(jStr(details, "Name"), "/")
	if verifiedName == "" {
		verifiedName = cleanName
	}
	if jStr(jObj(details, "State"), "Status") == "running" {
		return nil
	}
	time.Sleep(3 * time.Second)
	recheck, err := runner.InspectContainer(ctx, rr, newID)
	if err != nil {
		return fmt.Errorf("failed to verify network container %s: %w", cleanName, err)
	}
	if jStr(jObj(recheck, "State"), "Status") != "running" {
		return fmt.Errorf("network container %s is not running. Cannot create dependent containers.", verifiedName)
	}
	return nil
}

// restartPolicyOr mirrors Node's RestartPolicy normalization for recreates.
func restartPolicyOr(v any) any {
	switch t := v.(type) {
	case string:
		if t == "" {
			return map[string]any{"Name": "unless-stopped"}
		}
		return map[string]any{"Name": t}
	case map[string]any:
		return t
	default:
		return map[string]any{"Name": "unless-stopped"}
	}
}

// buildRecreateHostConfig rebuilds a dependent's HostConfig from scratch with
// the network_mode reference pointed at the new container ID.
func buildRecreateHostConfig(original map[string]any, prefix, newID string) map[string]any {
	get := func(key string, def any) any {
		if v, ok := original[key]; ok && jsTruthy(v) {
			return v
		}
		return def
	}
	clean := map[string]any{
		"NetworkMode":    prefix + newID,
		"RestartPolicy":  restartPolicyOr(original["RestartPolicy"]),
		"Binds":          get("Binds", []any{}),
		"Memory":         get("Memory", 0),
		"MemorySwap":     get("MemorySwap", 0),
		"CpuShares":      get("CpuShares", 0),
		"CpuPeriod":      get("CpuPeriod", 0),
		"CpuQuota":       get("CpuQuota", 0),
		"CpusetCpus":     get("CpusetCpus", ""),
		"CpusetMems":     get("CpusetMems", ""),
		"Devices":        get("Devices", []any{}),
		"DeviceRequests": get("DeviceRequests", []any{}),
		"CapAdd":         get("CapAdd", []any{}),
		"CapDrop":        get("CapDrop", []any{}),
		"SecurityOpt":    get("SecurityOpt", []any{}),
		"LogConfig":      get("LogConfig", map[string]any{}),
		"Privileged":     get("Privileged", false),
		"ReadonlyRootfs": get("ReadonlyRootfs", false),
		"ShmSize":        get("ShmSize", 67108864),
		"Tmpfs":          get("Tmpfs", map[string]any{}),
		"Ulimits":        get("Ulimits", []any{}),
		"UsernsMode":     get("UsernsMode", ""),
		"IpcMode":        get("IpcMode", ""),
		"PidMode":        get("PidMode", ""),
		"Isolation":      get("Isolation", ""),
		"AutoRemove":     get("AutoRemove", false),
	}
	// Drop empty arrays/objects so the create payload stays minimal.
	for k, v := range clean {
		switch t := v.(type) {
		case []any:
			if len(t) == 0 {
				delete(clean, k)
			}
		case map[string]any:
			if len(t) == 0 {
				delete(clean, k)
			}
		}
	}
	return clean
}

// buildRecreateNetworkingConfig is the recreate-path variant: null fields fall
// back to empty defaults which are then dropped (differs subtly from the
// main-path variant's JS-truthy retention; both mirror Node).
func buildRecreateNetworkingConfig(details map[string]any, shared bool) map[string]any {
	if shared {
		return nil
	}
	networks := jObj(jObj(details, "NetworkSettings"), "Networks")
	if networks == nil {
		return nil
	}
	endpoints := map[string]any{}
	for name, raw := range networks {
		data, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		endpoint := map[string]any{}
		if ipam, ok := data["IPAMConfig"].(map[string]any); ok && len(ipam) > 0 {
			endpoint["IPAMConfig"] = ipam
		}
		if links, ok := data["Links"].([]any); ok && len(links) > 0 {
			endpoint["Links"] = links
		}
		if aliases, ok := data["Aliases"].([]any); ok && len(aliases) > 0 {
			endpoint["Aliases"] = aliases
		}
		if len(endpoint) > 0 {
			endpoints[name] = endpoint
		}
	}
	if len(endpoints) == 0 {
		return nil
	}
	return map[string]any{"EndpointsConfig": endpoints}
}

func buildRecreateContainerConfig(details map[string]any, cleanHC, netCfg map[string]any, shared bool) map[string]any {
	config := jObj(details, "Config")
	out := map[string]any{
		"Image":      config["Image"],
		"HostConfig": cleanHC,
	}
	if config["Cmd"] != nil {
		out["Cmd"] = config["Cmd"]
	}
	if config["Env"] != nil {
		out["Env"] = config["Env"]
	}
	if config["Labels"] != nil {
		out["Labels"] = config["Labels"]
	}
	out["WorkingDir"] = config["WorkingDir"]
	if !shared {
		if ep, ok := config["ExposedPorts"].(map[string]any); ok && len(ep) > 0 {
			out["ExposedPorts"] = ep
		}
	}
	if jsTruthy(config["Entrypoint"]) {
		out["Entrypoint"] = config["Entrypoint"]
	}
	addPreservedConfigFields(out, config)
	if netCfg != nil {
		out["NetworkingConfig"] = netCfg
	}
	return out
}

// removeExistingContainer clears a stale name collision before recreation.
func removeExistingContainer(ctx context.Context, rr db.RunnerRow, containerName string) {
	list, err := runner.FetchContainers(ctx, rr)
	if err != nil {
		log.Printf("upgrade: could not check for existing container %s: %v", containerName, err)
		return
	}
	for _, c := range list {
		if c.Name != containerName {
			continue
		}
		_ = runner.StopContainer(ctx, rr, c.ID)
		if err := runner.RemoveContainer(ctx, rr, c.ID, false); err != nil {
			log.Printf("upgrade: could not remove existing container %s: %v", containerName, err)
		}
		time.Sleep(2 * time.Second)
		return
	}
}

// verifyAndRetryContainer re-creates once if Docker stored a wrong NetworkMode.
// Returns the ID of the container to use (original on any verification error).
func verifyAndRetryContainer(ctx context.Context, rr db.RunnerRow, newID, containerName, expectedNM string, containerConfig, cleanHC map[string]any) string {
	details, err := runner.InspectContainer(ctx, rr, newID)
	if err != nil {
		log.Printf("upgrade: could not verify created container NetworkMode: %v", err)
		return newID
	}
	actual := jStr(jObj(details, "HostConfig"), "NetworkMode")
	if actual == expectedNM {
		return newID
	}
	log.Printf("upgrade: created container NetworkMode mismatch: got %q, want %q; retrying", actual, expectedNM)
	if err := runner.RemoveContainer(ctx, rr, newID, false); err != nil {
		log.Printf("upgrade: could not remove mismatched container: %v", err)
	}
	time.Sleep(2 * time.Second)

	retry := make(map[string]any, len(containerConfig))
	for k, v := range containerConfig {
		retry[k] = v
	}
	retryHC := make(map[string]any, len(cleanHC))
	for k, v := range cleanHC {
		retryHC[k] = v
	}
	retryHC["NetworkMode"] = expectedNM
	retry["HostConfig"] = retryHC

	retryID, err := runner.CreateContainer(ctx, rr, retry, containerName)
	if err != nil {
		log.Printf("upgrade: retry create failed, keeping original: %v", err)
		return newID
	}
	retryDetails, err := runner.InspectContainer(ctx, rr, retryID)
	if err != nil {
		log.Printf("upgrade: could not verify retry container, keeping original: %v", err)
		return newID
	}
	if jStr(jObj(retryDetails, "HostConfig"), "NetworkMode") == expectedNM {
		return retryID
	}
	log.Printf("upgrade: retry NetworkMode still incorrect, keeping original")
	return newID
}

// recreateNetworkModeContainer rebuilds a network_mode dependent so its
// network_mode points at the new provider container ID.
func recreateNetworkModeContainer(ctx context.Context, rr db.RunnerRow, dep depAfter, details map[string]any, newID string) error {
	containerNM := jStr(jObj(details, "HostConfig"), "NetworkMode")
	prefix := "container:"
	if strings.HasPrefix(containerNM, "service:") {
		prefix = "service:"
	}

	originalHC := jObj(details, "HostConfig")
	if originalHC == nil {
		originalHC = map[string]any{}
	}
	cleanHC := buildRecreateHostConfig(originalHC, prefix, newID)
	preserveAnonymousVolumes(details, cleanHC)

	updatedNM := jStr(cleanHC, "NetworkMode")
	updatedShared := isSharedNetworkMode(updatedNM)
	if !updatedShared {
		if pb, ok := originalHC["PortBindings"]; ok && jsTruthy(pb) {
			cleanHC["PortBindings"] = pb
		}
		if pap, ok := originalHC["PublishAllPorts"]; ok {
			cleanHC["PublishAllPorts"] = pap
		}
	}

	netCfg := buildRecreateNetworkingConfig(details, updatedShared)
	containerConfig := buildRecreateContainerConfig(details, cleanHC, netCfg, updatedShared)

	containerName := strings.TrimPrefix(jStr(details, "Name"), "/")
	if containerName == "" {
		containerName = dep.Name
	}
	expectedNM := prefix + newID
	if jStr(jObj(containerConfig, "HostConfig"), "NetworkMode") != expectedNM {
		cleanHC["NetworkMode"] = expectedNM // containerConfig["HostConfig"] is the same map
	}

	removeExistingContainer(ctx, rr, containerName)

	newDepID, err := runner.CreateContainer(ctx, rr, containerConfig, containerName)
	if err != nil {
		return fmt.Errorf("create dependent %s: %w", containerName, err)
	}
	verifiedID := verifyAndRetryContainer(ctx, rr, newDepID, containerName, expectedNM, containerConfig, cleanHC)
	if err := runner.StartContainer(ctx, rr, verifiedID); err != nil {
		return fmt.Errorf("start dependent %s: %w", containerName, err)
	}
	return nil
}

// handleNetworkModeContainers snapshots details, removes all network_mode
// dependents, then recreates them against the new provider ID.
func handleNetworkModeContainers(ctx context.Context, rr db.RunnerRow, deps []depAfter, newID string) {
	detailsMap := map[string]map[string]any{}
	for _, d := range deps {
		details, err := runner.InspectContainer(ctx, rr, d.ID)
		if err != nil {
			log.Printf("upgrade: failed to get details for dependent %s: %v", d.Name, err)
			continue
		}
		detailsMap[d.ID] = details
	}
	for _, d := range deps {
		if err := runner.RemoveContainer(ctx, rr, d.ID, false); err != nil {
			log.Printf("upgrade: could not remove dependent %s: %v", d.Name, err)
		}
	}
	time.Sleep(5 * time.Second)
	for _, d := range deps {
		details, ok := detailsMap[d.ID]
		if !ok {
			log.Printf("upgrade: no details stored for dependent %s, skipping recreation", d.Name)
			continue
		}
		if err := recreateNetworkModeContainer(ctx, rr, d, details, newID); err != nil {
			log.Printf("upgrade: failed to recreate dependent %s: %v", d.Name, err)
		}
	}
}

// restartSingleContainer restarts a stack dependent (stop+start, or start for
// already-stopped containers).
func restartSingleContainer(ctx context.Context, rr db.RunnerRow, d depAfter) error {
	if d.Running {
		if err := runner.StopContainer(ctx, rr, d.ID); err != nil {
			return err
		}
		time.Sleep(1 * time.Second)
		return runner.StartContainer(ctx, rr, d.ID)
	}
	if d.Stopped {
		if err := runner.StartContainer(ctx, rr, d.ID); err == nil {
			return nil
		}
		_ = runner.StopContainer(ctx, rr, d.ID)
		time.Sleep(1 * time.Second)
		return runner.StartContainer(ctx, rr, d.ID)
	}
	return nil
}

// restartDependentContainers is the post-upgrade dependent restart entry
// point. Skipped entirely when the upgraded container itself consumes a
// shared network (it is a consumer, not a provider). preRestored names were
// just recreated from pre-stop snapshots by the success path; skipping them
// keeps the sweep from remove+recreating them a second time.
func restartDependentContainers(ctx context.Context, rr db.RunnerRow, newID, cleanName, originalID, stackName string, shared bool, preRestored map[string]bool) error {
	if shared {
		return nil
	}
	deps, err := findDependentContainersAfterUpgrade(ctx, rr, newID, cleanName, originalID, stackName)
	if err != nil {
		return err
	}
	if len(deps) == 0 {
		return nil
	}

	waitForUpgradedContainerHealth(ctx, rr, newID)

	var netDeps, otherDeps []depAfter
	for _, d := range deps {
		if preRestored[strings.TrimPrefix(d.Name, "/")] {
			continue
		}
		if d.Reason == "network_mode" {
			netDeps = append(netDeps, d)
		} else {
			otherDeps = append(otherDeps, d)
		}
	}

	if err := verifyUpgradedContainer(ctx, rr, newID, cleanName); err != nil {
		return err
	}

	if len(netDeps) > 0 {
		handleNetworkModeContainers(ctx, rr, netDeps, newID)
	}
	for _, d := range otherDeps {
		if err := restartSingleContainer(ctx, rr, d); err != nil {
			log.Printf("upgrade: failed to restart dependent %s: %v", d.Name, err)
		}
	}
	return nil
}

// restartSiblingContainers restarts other containers that share the same
// network provider as the (shared-network-mode) upgraded container.
func restartSiblingContainers(ctx context.Context, rr db.RunnerRow, originalDetails map[string]any, newID string) {
	provider := networkModeRef(jStr(jObj(originalDetails, "HostConfig"), "NetworkMode"))
	if provider == "" {
		return
	}
	list, err := runner.FetchContainers(ctx, rr)
	if err != nil {
		log.Printf("upgrade: could not list containers for sibling restart: %v", err)
		return
	}
	for _, c := range list {
		if c.ID == newID {
			continue
		}
		details, err := runner.InspectContainer(ctx, rr, c.ID)
		if err != nil {
			continue
		}
		nm := jStr(jObj(details, "HostConfig"), "NetworkMode")
		if networkModeRef(nm) != provider || !inspectRunning(details) {
			continue
		}
		if err := runner.StopContainer(ctx, rr, c.ID); err != nil {
			log.Printf("upgrade: failed to stop sibling %s: %v", c.Name, err)
			continue
		}
		time.Sleep(1 * time.Second)
		if err := runner.StartContainer(ctx, rr, c.ID); err != nil {
			log.Printf("upgrade: failed to start sibling %s: %v", c.Name, err)
		}
	}
}

// ── Blocklist ───────────────────────────────────────────────────────────────

// upgradeBlocklisted mirrors Node's isContainerDisallowed: with no saved list,
// match image-name substrings against defaultBlockedPatterns; with a saved JSON
// list, exact container-name match. Any read/parse error means "not blocked".
func (r *mutationResolver) upgradeBlocklisted(ctx context.Context, uid int64, containerName, imageName string) bool {
	raw, err := db.GetSetting(ctx, r.DB, "disallowed_containers", uid)
	if err != nil {
		log.Printf("upgrade: failed to read disallowed_containers: %v", err)
		return false
	}
	if raw == nil || *raw == "" { // Node's `!setting` is falsy for "" too
		lower := strings.ToLower(imageName)
		for _, p := range defaultBlockedPatterns {
			if strings.Contains(lower, p) {
				return true
			}
		}
		return false
	}
	var list []string
	if err := json.Unmarshal([]byte(*raw), &list); err != nil {
		log.Printf("upgrade: disallowed_containers is not a valid array: %v", err)
		return false
	}
	target := strings.ToLower(containerName)
	for _, n := range list {
		if strings.ToLower(n) == target {
			return true
		}
	}
	return false
}

// ── Main pipeline ───────────────────────────────────────────────────────────

// upgradeImageRef normalizes the target image: strips any @sha256 digest
// suffix and guarantees an explicit tag (untagged images become :latest).
func upgradeImageRef(imageName string) string {
	if idx := strings.Index(imageName, "@sha256"); idx >= 0 {
		imageName = imageName[:idx]
	}
	repo, tag := imageName, "latest"
	// Tag is the segment after the LAST colon, but only when that colon comes
	// after the last slash (registry host ports are not tags).
	if idx := strings.LastIndex(imageName, ":"); idx > 0 && !strings.Contains(imageName[idx:], "/") {
		repo, tag = imageName[:idx], imageName[idx+1:]
	}
	return repo + ":" + tag
}

func setPhase(phase func(model.UpgradePhase), p model.UpgradePhase) {
	if phase != nil {
		phase(p)
	}
}

// runnerUpgradePipeline orchestrates a runner container upgrade through the
// runner's fine-grained Docker API, mirroring Node's upgradeSingleContainer:
// inspect → blocklist → stop+remove dependents → stop → wait stop → pull →
// remove → prepare config → create → start → wait ready → restart
// dependents/siblings. Intermediate phases are reported through phase (may be
// nil); the caller owns the terminal COMPLETED/FAILED event and history row.
func (r *mutationResolver) runnerUpgradePipeline(ctx context.Context, uid int64, container *db.ContainerRow, rr *db.RunnerRow, imageName string, phase func(model.UpgradePhase)) error {
	// Inspect the current container: the authoritative config source.
	details, err := runner.InspectContainer(ctx, *rr, container.ContainerID)
	if err != nil {
		return fmt.Errorf("inspect container: %w", err)
	}
	originalName := jStr(details, "Name")
	if originalName == "" {
		originalName = "/" + container.ContainerName
	}
	cleanName := strings.TrimPrefix(originalName, "/")

	if imageName == "" && container.ImageName.Valid {
		imageName = container.ImageName.String
	}

	// Blocklist check (image-name defaults when no explicit list is saved).
	if r.upgradeBlocklisted(ctx, uid, cleanName, imageName) {
		return fmt.Errorf("container %q is in the upgrade blocklist and cannot be upgraded", cleanName)
	}

	// Upgrade keeps the current tag: pull the newest digest for that tag.
	newImage := upgradeImageRef(imageName)

	// Stop+remove network_mode dependents BEFORE removing their provider.
	deps := findDependentContainers(ctx, *rr, container.ContainerID, cleanName)
	if len(deps) > 0 {
		stopAndRemoveDependentContainers(ctx, *rr, deps)
	}
	// From here the dependents are already gone: any failure below must put
	// the SERVICE back too, not just the dependents. A pull failure would
	// otherwise leave the container stopped forever, and a create/start
	// failure (after remove) would leave it deleted with its config only in
	// this snapshot.
	removed := false
	var newID string
	restore := func() {
		if len(deps) > 0 {
			// Full recovery (provider start/recreate + dependents) lives in
			// restoreRemovedDependents.
			restoreRemovedDependents(ctx, *rr, deps, cleanName, details)
			return
		}
		// No dependents: restoreRemovedDependents would do nothing, but the
		// service itself still needs putting back — a pull failure would
		// leave it stopped forever, and a create/start failure (after
		// remove) would leave it deleted with its config only in this
		// snapshot.
		if !removed {
			if err := runner.StartContainer(ctx, *rr, container.ContainerID); err != nil {
				slog.Warn("upgrade rollback: start original container failed", "container", cleanName, "error", err)
			}
			return
		}
		// A half-created replacement (create succeeded but start/ready
		// failed) squats on the original name: vacate it first.
		if newID != "" {
			if err := runner.RemoveContainer(ctx, *rr, newID, true); err != nil {
				slog.Warn("upgrade rollback: remove failed replacement failed", "container", cleanName, "error", err)
			}
		}
		origImage := jStr(details, "Image")
		if origImage == "" {
			origImage = jStr(jObj(details, "Config"), "Image")
		}
		if origImage == "" {
			origImage = imageName
		}
		origCfg, _, _ := prepareContainerConfig(details, origImage, originalName)
		id, err := runner.CreateContainer(ctx, *rr, origCfg, originalName)
		if err != nil {
			slog.Error("upgrade rollback: recreate original container failed", "container", cleanName, "error", err)
			return
		}
		if id != "" {
			if err := runner.StartContainer(ctx, *rr, id); err != nil {
				slog.Warn("upgrade rollback: start recreated original failed", "container", cleanName, "error", err)
			}
		}
	}

	setPhase(phase, model.UpgradePhaseStopping)
	if err := runner.StopContainer(ctx, *rr, container.ContainerID); err != nil {
		restore()
		return fmt.Errorf("stop container: %w", err)
	}
	waitForContainerStop(ctx, *rr, container.ContainerID, cleanName)

	setPhase(phase, model.UpgradePhasePulling)
	if err := runner.PullImage(ctx, *rr, newImage); err != nil {
		restore()
		return fmt.Errorf("pull image %s: %w", newImage, err)
	}

	if err := runner.RemoveContainer(ctx, *rr, container.ContainerID, false); err != nil {
		restore()
		return fmt.Errorf("remove container: %w", err)
	}
	removed = true

	setPhase(phase, model.UpgradePhaseRecreating)
	config, shared, stackName := prepareContainerConfig(details, newImage, originalName)
	newID, err = runner.CreateContainer(ctx, *rr, config, originalName)
	if err != nil {
		restore()
		return fmt.Errorf("create container: %w", err)
	}
	if newID == "" {
		restore()
		return fmt.Errorf("runner create returned no container id")
	}

	setPhase(phase, model.UpgradePhaseStarting)
	if err := runner.StartContainer(ctx, *rr, newID); err != nil {
		restore()
		return fmt.Errorf("start container: %w", err)
	}
	if err := waitForContainerReady(ctx, *rr, newID, cleanName, imageName); err != nil {
		restore()
		return err
	}

	// Dependent restarts must not fail an otherwise successful upgrade.
	setPhase(phase, model.UpgradePhaseRestartingDependents)
	preRestored := map[string]bool{}
	if len(deps) > 0 {
		// The up-front removal deleted these dependents; the post-upgrade
		// sweep only sees containers that still exist, so recreate them
		// from their pre-stop snapshots against the new provider first.
		waitForUpgradedContainerHealth(ctx, *rr, newID)
		restoreRemovedDependents(ctx, *rr, deps, cleanName, details)
		for _, d := range deps {
			preRestored[d.Name] = true
		}
	}
	if err := restartDependentContainers(ctx, *rr, newID, cleanName, container.ContainerID, stackName, shared, preRestored); err != nil {
		log.Printf("upgrade %s: restart dependent containers failed: %v", cleanName, err)
	}
	if shared {
		restartSiblingContainers(ctx, *rr, details, newID)
	}
	return nil
}

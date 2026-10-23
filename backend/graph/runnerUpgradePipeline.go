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
	"math/rand"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/domain"
	"github.com/dockedapp/backend/internal/runner"
)

// OriginalImageLabel is stamped on every container the upgrade pipeline
// recreates (main replacement, provider restoration, dependent recreation,
// verification retry). Its value is the ORIGINAL user-visible image
// reference from the pre-upgrade Config.Image (e.g. "nginx:1.25") — NOT the
// pinned sha256 digest the create actually runs from. The UI needs the human
// reference; execution stays pinned to the immutable digest. imagesync reads
// it when scanning, and the live container path reads it when listing, so a
// pinned container keeps its identity and its update status.
const OriginalImageLabel = domain.OriginalImageLabel

// stampOriginalImage attaches OriginalImageLabel to a create payload without
// mutating the inspect document (buildUpgradeConfig/buildRecreateContainerConfig
// alias the Config.Labels map).
func stampOriginalImage(cfg map[string]any, originalImage string) {
	if originalImage == "" {
		return
	}
	// A bare image ID is not a reference: stamping it would overwrite the good
	// reference an earlier recreation left behind and leave the container
	// unidentifiable to both the scan and the live listing (a container
	// upgraded twice lost its update status for exactly this reason). Returning
	// early keeps the inherited label intact.
	if strings.HasPrefix(originalImage, "sha256:") {
		return
	}
	labels, _ := cfg["Labels"].(map[string]any)
	stamped := make(map[string]any, len(labels)+1)
	for k, v := range labels {
		stamped[k] = v
	}
	stamped[OriginalImageLabel] = originalImage
	cfg["Labels"] = stamped
}

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

// startDepLockHeartbeat keeps every held dependent lock in
// acquireUpgradeLockSet alive on the same 60s cadence as startLockHeartbeat
// (which only covers a single target key).
func (r *Resolver) startDepLockHeartbeat(targetKeys []string, owner string) (stop func()) {
	done := make(chan struct{})
	var once sync.Once
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				for _, key := range targetKeys {
					if err := db.RefreshUpgradeLock(context.Background(), r.DB, key, owner); err != nil {
						slog.Warn("dependent upgrade lock refresh failed", "target", key, "error", err.Error())
					}
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
	// NOTE: Runtime is deliberately KEPT: it is a valid create field, and
	// dropping it silently downgrades containers pinned to a non-default
	// sandbox runtime (e.g. runsc) to the daemon default on recreate.
	for _, k := range []string{
		"ContainerIDFile", "ResolvConfPath", "HostnamePath", "HostsPath",
		"RestartCount", "AutoRemove",
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
		// DriverOpts is a writable endpoint setting (macvlan options,
		// com.docker.network.driver.mtu, ...): dropping it silently strips
		// configured network identity. Dynamic per-attach fields (IPAddress,
		// Gateway, GatewayPriority, MAC) are NOT create-writable and stay
		// dropped so Docker re-assigns them.
		if jsTruthy(data["DriverOpts"]) {
			endpoint["DriverOpts"] = data["DriverOpts"]
		}
		// Keep the network even when the endpoint config is empty: dropping
		// it detaches the container from that secondary network on recreate.
		// Docker accepts an empty endpoint object and attaches with defaults.
		endpoints[name] = endpoint
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
		// Explicit hostnames carry application identity (service discovery,
		// license files, logs); dropping them makes Docker assign a new
		// random one. Docker rejects Hostname alongside a shared
		// (container:/pod:) network mode, so keep them only when standalone.
		if hn := jStr(config, "Hostname"); hn != "" {
			out["Hostname"] = hn
		}
		if dn := jStr(config, "Domainname"); dn != "" {
			out["Domainname"] = dn
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
	cfg := buildUpgradeConfig(details, newImage, cleanHC, netCfg, shared)
	// Keep the user-visible image reference on the recreated container even
	// though the create may run from a pinned digest or a moved tag.
	stampOriginalImage(cfg, jStr(jObj(details, "Config"), "Image"))
	return cfg, shared, stackName
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
	// --mount volumes ride along in HostConfig.Mounts (cleanHostConfig
	// copies it verbatim into the create payload). Re-adding one as a bind
	// gives Docker the same destination twice and it rejects BOTH the
	// upgrade and the rollback create, after the original is already gone.
	//
	// ANONYMOUS --mount volumes (type=volume, empty Source) must be pinned
	// to the existing volume: echoed unpinned, Docker allocates a brand-new
	// EMPTY volume and the container's data is orphaned. The inspect Mounts
	// list carries the generated volume name for each destination.
	volNames := map[string]string{} // Destination -> volume name
	for _, m := range mounts {
		if mm, ok := m.(map[string]any); ok && jStr(mm, "Type") == "volume" {
			if n := jStr(mm, "Name"); n != "" {
				volNames[jStr(mm, "Destination")] = n
			}
		}
	}
	if hm, ok := cleanHC["Mounts"].([]any); ok {
		pinned := make([]any, 0, len(hm))
		for _, m := range hm {
			mm, ok := m.(map[string]any)
			if !ok {
				pinned = append(pinned, m)
				continue
			}
			if jStr(mm, "Type") == "volume" && jStr(mm, "Source") == "" && jStr(mm, "Name") == "" {
				if n := volNames[jStr(mm, "Target")]; n != "" {
					// Copy before mutating: cleanHostConfigForCreate only
					// shallow-copies, so mm aliases the inspect document.
					fixed := make(map[string]any, len(mm)+1)
					for k, v := range mm {
						fixed[k] = v
					}
					fixed["Source"] = n
					log.Printf("upgrade: pinning anonymous volume %s to %s", n, jStr(mm, "Target"))
					mm = fixed
				}
			}
			for _, k := range []string{"Target", "Source", "Name"} {
				if v := jStr(mm, k); v != "" {
					covered[v] = true
				}
			}
			pinned = append(pinned, mm)
		}
		cleanHC["Mounts"] = pinned
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
		mode := jStr(mm, "Mode")
		if mode == "" {
			// Inspect reports RW as the authoritative access flag and Mode
			// is often empty for volume mounts: without this a read-only
			// volume would come back writable on recreate.
			if rw, ok := mm["RW"].(bool); ok && !rw {
				mode = "ro"
			}
		}
		if mode != "" {
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

// lockReleaseTimeout bounds a lock release that runs on a detached context.
// Release is routinely called after the owning operation has already been
// canceled or timed out, so it cannot reuse that context — but it must not hang
// either.
const lockReleaseTimeout = 10 * time.Second

// acquireUpgradeLockSet atomically acquires upgrade locks for a set of
// container IDs (lock keys are sorted for deterministic ordering). When
// requireAll is true, any contended ID releases the whole set and returns an
// error; when false, contended IDs are simply omitted from the returned map,
// which is keyed by container ID. The returned release function frees every
// held lock and stops the heartbeat.
func (r *mutationResolver) acquireUpgradeLockSet(ctx context.Context, rr db.RunnerRow, owner string, ids []string, requireAll bool) (map[string]bool, func(), error) {
	idByKey := make(map[string]string, len(ids))
	for _, id := range ids {
		key := containerTargetKey(id, &rr.ID)
		if _, dup := idByKey[key]; !dup {
			idByKey[key] = id
		}
	}
	keys := make([]string, 0, len(idByKey))
	for k := range idByKey {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	held := make(map[string]bool, len(keys))
	for _, key := range keys {
		locked, err := db.AcquireUpgradeLock(ctx, r.DB, key, owner)
		if err != nil || !locked {
			if requireAll {
				// Rollback must not inherit the caller's cancellation: a
				// canceled request context would leave the locks we already
				// took stranded until they expire, blocking the containers for
				// the whole lock TTL.
				for k := range held {
					rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), lockReleaseTimeout)
					_ = db.ReleaseUpgradeLock(rctx, r.DB, containerTargetKey(k, &rr.ID), owner)
					cancel()
				}
				if err == nil {
					err = fmt.Errorf("lock already held by another operation")
				}
				return nil, nil, fmt.Errorf("container %q is being modified by another operation: %w", key, err)
			}
			continue
		}
		held[idByKey[key]] = true
	}
	if len(held) == 0 {
		return held, func() {}, nil
	}

	stopHB := r.startDepLockHeartbeat(keys, owner)
	release := func() {
		stopHB()
		// Detached for the same reason as the rollback path above: release
		// routinely runs after the pipeline has timed out or the client has
		// hung up, and a lock that fails to release here pins the container
		// for the full TTL.
		rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), lockReleaseTimeout)
		defer cancel()
		for k := range held {
			_ = db.ReleaseUpgradeLock(rctx, r.DB, containerTargetKey(k, &rr.ID), owner)
		}
	}
	return held, release, nil
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
		// Only RUNNING samples count toward the stable-run streak: the old
		// unconditional increment let a container that polled "created" or
		// "restarting" ten times pass the consecutive threshold on its very
		// first running sample. Any non-running sample resets the streak.
		if inspectRunning(details) {
			consecutive++
		} else {
			consecutive = 0
		}
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
	// Running is the dependent's state at capture time. Stopped
	// network_mode dependents are captured too (their network_mode dies with
	// the provider, so they must be recreated against the new one) but must
	// NOT be started back: the user stopped them deliberately.
	Running bool
	// Details is the inspect document captured BEFORE the dependent was
	// removed; it is the only way back if the pipeline fails midway.
	Details map[string]any
}

// findDependentContainers lists containers whose network_mode references the
// target by name or full ID. Running AND stopped dependents are captured:
// a stopped dependent's network_mode reference dies with the provider too,
// so it must be recreated (but left stopped).
//
// Discovery is all-or-nothing on purpose. The caller stops and removes these
// containers before recreating the provider, so a partial snapshot is worse
// than no snapshot: an unlisted dependent is left wired to a container ID that
// is about to be deleted, and rollback never sees it. Any listing or inspect
// failure is therefore returned as an error so the caller can abort before the
// first destructive call.
func findDependentContainers(ctx context.Context, rr db.RunnerRow, targetID, cleanName string) ([]depContainer, error) {
	list, err := runner.FetchContainers(ctx, rr)
	if err != nil {
		return nil, fmt.Errorf("list containers to find dependents of %s: %w", cleanName, err)
	}
	var deps []depContainer
	for _, c := range list {
		if c.ID == targetID || cleanName == "" {
			continue
		}
		details, err := runner.InspectContainer(ctx, rr, c.ID)
		if err != nil {
			return nil, fmt.Errorf("inspect container %s while finding dependents of %s: %w", c.Name, cleanName, err)
		}
		nm := jStr(jObj(details, "HostConfig"), "NetworkMode")
		// Match by name OR full container ID: dependents created by compose
		// or `docker run --net container:<64-hex-id>` reference the provider
		// by ID, and name-only matching silently skipped them — rollback then
		// left them wired to the deleted old provider ID.
		if !networkModeMatches(nm, cleanName, targetID, targetID) {
			continue
		}
		status := restartStatus(details)
		if status == "running" || status == "exited" || status == "stopped" {
			deps = append(deps, depContainer{
				ID: c.ID, Name: c.Name, Details: details,
				Running: status == "running",
			})
		}
	}
	return deps, nil
}

// stopAndRemoveDependentContainers removes (not just stops) dependents so
// compose does not auto-recreate them against the old provider container ID.
// Only running dependents are stopped first; stopped ones are removed
// directly (stopping them would fail, and they must not come back up).
func stopAndRemoveDependentContainers(ctx context.Context, rr db.RunnerRow, deps []depContainer) {
	for _, d := range deps {
		if d.Running {
			if err := runner.StopContainer(ctx, rr, d.ID); err != nil {
				log.Printf("upgrade: dependent %s may already be stopped: %v", d.Name, err)
			}
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
func restoreRemovedDependents(ctx context.Context, rr db.RunnerRow, deps []depContainer, cleanName string, providerDetails map[string]any) error {
	// Respect the caller's budget: restore() already hands us a detached
	// context with its own timeout. Only detach here when the caller gave
	// no deadline at all (WithoutCancel would otherwise discard one).
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
		defer cancel()
	}
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
			log.Printf("upgrade: could not recreate provider %s: %v", cleanName, err)
			return fmt.Errorf("recreate provider %s: %w", cleanName, err)
		}
		providerID = id
		if err := runner.StartContainer(ctx, rr, providerID); err != nil {
			log.Printf("upgrade: provider %s recreated but failed to start: %v", cleanName, err)
		}
	} else if details, err := runner.InspectContainer(ctx, rr, providerID); err == nil && restartStatus(details) != "running" {
		// The pipeline stopped the provider before failing (pull/remove
		// path): dependents recreated with network_mode:container:<id>
		// cannot start against a stopped provider, so bring it back up.
		if err := runner.StartContainer(ctx, rr, providerID); err != nil {
			log.Printf("upgrade: provider %s exists but failed to start: %v", cleanName, err)
		}
	}

	var errs []error
	oldProviderID := jStr(providerDetails, "Id")
	for _, d := range deps {
		if d.Details == nil {
			log.Printf("upgrade: no snapshot for dependent %s, cannot restore", d.Name)
			errs = append(errs, fmt.Errorf("no snapshot for dependent %s", d.Name))
			continue
		}
		// Running state comes from the PRE-STOP snapshot: a dependent the
		// user had stopped must come back recreated-but-not-started.
		dep := depAfter{ID: d.ID, Name: d.Name, Running: d.Running && inspectRunning(d.Details)}
		if err := recreateNetworkModeContainer(ctx, rr, dep, d.Details, providerID, oldProviderID); err != nil {
			log.Printf("upgrade: could not restore dependent %s: %v", d.Name, err)
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
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
			// Not fatal: the upgrade has already succeeded, and aborting here
			// would take the service down over a bookkeeping gap. Logged so a
			// dependent that silently missed its restart is at least traceable.
			slog.Warn("post-upgrade dependent scan: inspect failed, container skipped",
				"container", c.Name, "id", c.ID, "error", err.Error())
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
			if stack == stackName && running {
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
	// Copy everything and strip only what the create endpoint rejects. The
	// previous hand-curated allowlist silently dropped fields like GroupAdd,
	// NanoCpus and PidsLimit on every dependent recreate; this mirrors the
	// battle-tested copy-and-strip of cleanHostConfigForCreate (provider path).
	clean := make(map[string]any, len(original))
	for k, v := range original {
		clean[k] = v
	}
	// Runtime is KEPT here too (see cleanHostConfigForCreate): dropping it
	// would downgrade runsc/kata dependents to the daemon default runtime.
	for _, k := range []string{
		"ContainerIDFile", "ResolvConfPath", "HostnamePath", "HostsPath",
		"RestartCount", "AutoRemove",
	} {
		delete(clean, k)
	}
	// Dependents always join via shared network mode: ports are exposed on
	// the provider, and echoing PortBindings makes the create fail.
	delete(clean, "PortBindings")
	delete(clean, "PublishAllPorts")

	clean["NetworkMode"] = prefix + newID
	clean["RestartPolicy"] = restartPolicyOr(original["RestartPolicy"])

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

// remapSharedModeRefs rewrites IpcMode/PidMode references that point at the
// provider container the pipeline just deleted. buildRecreateHostConfig
// re-points NetworkMode at the new provider, but a copied IpcMode/PidMode of
// "container:<old ref>" (or the bare sandbox-ID form swarm tasks use) would
// make Docker reject the create — or silently join a stale container.
// oldRef is the dependent's network_mode reference (provider name or ID),
// oldID the provider's full container ID before deletion.
func remapSharedModeRefs(cleanHC map[string]any, oldRef, oldID, newID string) {
	for _, key := range []string{"IpcMode", "PidMode"} {
		v, ok := cleanHC[key].(string)
		if !ok || v == "" {
			continue
		}
		if rest, isCtr := strings.CutPrefix(v, "container:"); isCtr {
			if (oldRef != "" && rest == oldRef) || (oldID != "" && rest == oldID) {
				cleanHC[key] = "container:" + newID
			}
			continue
		}
		// Bare form: the raw sandbox container ID.
		if oldID != "" && v == oldID && fullIDRe.MatchString(v) {
			cleanHC[key] = newID
		}
	}
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
		// DriverOpts is create-writable network identity (see the main-path
		// variant); dynamic fields (IPAddress, Gateway, MAC) stay dropped.
		if d, ok := data["DriverOpts"].(map[string]any); ok && len(d) > 0 {
			endpoint["DriverOpts"] = d
		}
		// Keep empty endpoint configs: dropping the entry detaches the
		// container from that network on recreate (see the main-path
		// variant's identical fix).
		endpoints[name] = endpoint
	}
	if len(endpoints) == 0 {
		return nil
	}
	return map[string]any{"EndpointsConfig": endpoints}
}

func buildRecreateContainerConfig(details map[string]any, cleanHC, netCfg map[string]any, shared bool) map[string]any {
	config := jObj(details, "Config")
	out := map[string]any{
		"HostConfig": cleanHC,
	}
	// Pin to the inspected image ID (top-level Image is "sha256:..."):
	// recreating from the mutable tag could silently jump the dependent to
	// a different build if the tag moved in the meantime. The ID is present
	// locally — the container we just removed ran from it.
	if imageID := jStr(details, "Image"); strings.HasPrefix(imageID, "sha256:") {
		out["Image"] = imageID
	} else {
		out["Image"] = config["Image"]
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
	// Execution is pinned to the digest above; keep the user-visible
	// reference for the UI (contract with the imagesync/UI side).
	stampOriginalImage(out, jStr(config, "Image"))
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
// Returns the ID of the container the caller must use, or an error when no
// usable container survives: the old code returned the ORIGINAL ID after
// having already removed it (retry create/inspect failed), so the caller
// proceeded to start a container that no longer existed.
func verifyAndRetryContainer(ctx context.Context, rr db.RunnerRow, newID, containerName, expectedNM string, containerConfig, cleanHC map[string]any) (string, error) {
	details, err := runner.InspectContainer(ctx, rr, newID)
	if err != nil {
		log.Printf("upgrade: could not verify created container NetworkMode: %v", err)
		return newID, nil
	}
	actual := jStr(jObj(details, "HostConfig"), "NetworkMode")
	if actual == expectedNM {
		return newID, nil
	}
	log.Printf("upgrade: created container NetworkMode mismatch: got %q, want %q; retrying", actual, expectedNM)
	removedFirst := false
	if err := runner.RemoveContainer(ctx, rr, newID, false); err != nil {
		log.Printf("upgrade: could not remove mismatched container: %v", err)
	} else {
		removedFirst = true
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
		if removedFirst {
			// The mismatched container is gone and the retry failed: there
			// is nothing to hand back. Fail so the outer recreate retries
			// from a clean slate instead of starting a deleted ID.
			return "", fmt.Errorf("retry create for %s failed after the mismatched container was removed: %w", containerName, err)
		}
		log.Printf("upgrade: retry create failed, keeping original: %v", err)
		return newID, nil
	}
	retryDetails, err := runner.InspectContainer(ctx, rr, retryID)
	if err != nil {
		// The retry exists but is unverifiable: hand back the SURVIVING
		// retry ID, never the removed original.
		log.Printf("upgrade: could not verify retry container, keeping it: %v", err)
		return retryID, nil
	}
	if jStr(jObj(retryDetails, "HostConfig"), "NetworkMode") == expectedNM {
		return retryID, nil
	}
	log.Printf("upgrade: retry NetworkMode still incorrect, failing for outer retry")
	return "", fmt.Errorf("created container %s NetworkMode stayed %q, want %q", containerName,
		jStr(jObj(retryDetails, "HostConfig"), "NetworkMode"), expectedNM)
}

// recreateNetworkModeContainer rebuilds a network_mode dependent so its
// network_mode points at the new provider container ID. The dependent was
// already REMOVED by the caller, so a failed recreation is data loss: retry a
// bounded number of times (transient engine errors are the common case)
// before reporting the failure upward. oldID is the provider's full ID
// before deletion (for IpcMode/PidMode reference remapping).
func recreateNetworkModeContainer(ctx context.Context, rr db.RunnerRow, dep depAfter, details map[string]any, newID, oldID string) error {
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		if err := recreateNetworkModeContainerOnce(ctx, rr, dep, details, newID, oldID); err != nil {
			lastErr = err
			log.Printf("upgrade: dependent %s recreate attempt %d/3 failed: %v", dep.Name, attempt, err)
			if ctx.Err() != nil {
				break
			}
			time.Sleep(time.Duration(attempt) * time.Second)
			continue
		}
		return nil
	}
	return lastErr
}

func recreateNetworkModeContainerOnce(ctx context.Context, rr db.RunnerRow, dep depAfter, details map[string]any, newID, oldID string) error {
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
	// NetworkMode was re-pointed above; IpcMode/PidMode copied verbatim can
	// still reference the DELETED provider, which makes Docker reject the
	// create or misconfigure the dependent. Re-point those too.
	remapSharedModeRefs(cleanHC, networkModeRef(containerNM), oldID, newID)
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
	verifiedID, err := verifyAndRetryContainer(ctx, rr, newDepID, containerName, expectedNM, containerConfig, cleanHC)
	if err != nil {
		return fmt.Errorf("verify dependent %s: %w", containerName, err)
	}
	// Only start dependents that were RUNNING before the operation: a
	// deliberately stopped one comes back recreated-but-stopped.
	if dep.Running {
		if err := runner.StartContainer(ctx, rr, verifiedID); err != nil {
			return fmt.Errorf("start dependent %s: %w", containerName, err)
		}
	}
	return nil
}

// handleNetworkModeContainers snapshots details, removes all network_mode
// dependents, then recreates them against the new provider ID. Recreation
// failures are returned: these dependents were removed by us, so swallowing
// the error would report a clean upgrade over permanent config loss.
// oldID is the upgraded provider's full ID before deletion.
func (r *mutationResolver) handleNetworkModeContainers(ctx context.Context, rr db.RunnerRow, deps []depAfter, newID, oldID string) error {
	detailsMap := map[string]map[string]any{}
	for _, d := range deps {
		details, err := runner.InspectContainer(ctx, rr, d.ID)
		if err != nil {
			log.Printf("upgrade: failed to get details for dependent %s: %v", d.Name, err)
			continue
		}
		detailsMap[d.ID] = details
	}
	// These dependents were NOT part of the up-front locked set (inspect
	// flake during the pre-scan, or created mid-pipeline): claim their
	// upgrade locks too, sorted and non-blocking, so a concurrent
	// authorized upgrade of one of them cannot interleave with our
	// remove+recreate. Contended dependents are left untouched.
	lockOwner := fmt.Sprintf("pipeline-sweep-%d-%d", time.Now().UnixNano(), rand.Int63())
	lockIDs := make([]string, 0, len(deps))
	for _, d := range deps {
		if _, ok := detailsMap[d.ID]; ok {
			lockIDs = append(lockIDs, d.ID)
		}
	}
	locked, releaseLocks, _ := r.acquireUpgradeLockSet(ctx, rr, lockOwner, lockIDs, false)
	defer releaseLocks()

	for _, d := range deps {
		if _, ok := detailsMap[d.ID]; !ok {
			// No snapshot means no recreation: removing it here would
			// destroy a working (or stopped) dependent's config for good
			// over a transient inspect failure. Leave it alone.
			continue
		}
		if !locked[d.ID] {
			log.Printf("upgrade: dependent %s is part of another upgrade, leaving it alone", d.Name)
			continue
		}
		if err := runner.RemoveContainer(ctx, rr, d.ID, false); err != nil {
			log.Printf("upgrade: could not remove dependent %s: %v", d.Name, err)
		}
	}
	time.Sleep(5 * time.Second)
	var errs []error
	for _, d := range deps {
		details, ok := detailsMap[d.ID]
		if !ok {
			log.Printf("upgrade: no details stored for dependent %s, skipping recreation", d.Name)
			continue
		}
		if !locked[d.ID] {
			continue
		}
		if err := recreateNetworkModeContainer(ctx, rr, d, details, newID, oldID); err != nil {
			log.Printf("upgrade: failed to recreate dependent %s: %v", d.Name, err)
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// restartSingleContainer restarts a running stack dependent (stop+start). A
// dependent that is not running was stopped by its owner, not by us - the ones
// this pipeline stopped are already accounted for in preRestored - so it stays
// stopped: starting it here would silently undo a deliberate choice.
func restartSingleContainer(ctx context.Context, rr db.RunnerRow, d depAfter) error {
	if !d.Running {
		return nil
	}
	if err := runner.StopContainer(ctx, rr, d.ID); err != nil {
		return err
	}
	time.Sleep(1 * time.Second)
	return runner.StartContainer(ctx, rr, d.ID)
}

// restartDependentContainers is the post-upgrade dependent restart entry
// point. Skipped entirely when the upgraded container itself consumes a
// shared network (it is a consumer, not a provider). preRestored names were
// just recreated from pre-stop snapshots by the success path; skipping them
// keeps the sweep from remove+recreating them a second time.
// restartDependentContainers is the post-upgrade recovery sweep. It recreates
// any dependent that was removed (or never existed) and restarts the survivors
// so they re-attach to the new provider. It also covers stack dependents that
// were not stopped up front: network_mode dependents are recreated against the
// new provider, and stack dependents are only restarted when they were already
// running (stopped ones stay stopped).
func (r *mutationResolver) restartDependentContainers(ctx context.Context, rr db.RunnerRow, newID, cleanName, originalID, stackName string, shared bool, preRestored map[string]bool, owned map[string]bool) error {
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

	var errs []error
	if len(netDeps) > 0 {
		// These dependents were REMOVED by the pipeline; a recreation
		// failure is permanent loss and must reach the caller.
		if err := r.handleNetworkModeContainers(ctx, rr, netDeps, newID, originalID); err != nil {
			errs = append(errs, err)
		}
	}
	if len(otherDeps) > 0 {
		// A stack dependent can itself be the target of a concurrent upgrade
		// (batch or single-container). Stopping it out from under that
		// operation loses its rollback, so claim its lock first and leave
		// anything busy alone. `owned` are the dependents this pipeline
		// already locked up front: those are ours to restart, and re-claiming
		// them under a new owner would only make them look busy.
		ids := make([]string, 0, len(otherDeps))
		for _, d := range otherDeps {
			if !owned[d.ID] {
				ids = append(ids, d.ID)
			}
		}
		held, release := r.claimRestartLocks(ctx, rr, ids)
		if release != nil {
			defer release()
		}
		for _, d := range otherDeps {
			if !owned[d.ID] && !held[d.ID] {
				log.Printf("upgrade: dependent %s is part of another upgrade, leaving it alone", d.Name)
				continue
			}
			// Stack dependents were never removed by us (compose owns their
			// lifecycle): a failed restart is logged, not fatal.
			if err := restartSingleContainer(ctx, rr, d); err != nil {
				log.Printf("upgrade: failed to restart dependent %s: %v", d.Name, err)
			}
		}
	}
	return errors.Join(errs...)
}

// claimRestartLocks locks the given containers for this pipeline's exclusive
// use and returns the subset it holds plus the release func. Containers another
// operation already locked are omitted.
func (r *mutationResolver) claimRestartLocks(ctx context.Context, rr db.RunnerRow, ids []string) (map[string]bool, func()) {
	if len(ids) == 0 {
		return map[string]bool{}, nil
	}
	owner := fmt.Sprintf("pipeline-restart-%d-%d", time.Now().UnixNano(), rand.Int63())
	held, release, err := r.acquireUpgradeLockSet(ctx, rr, owner, ids, false)
	if err != nil {
		log.Printf("upgrade: could not claim restart locks: %v", err)
	}
	if held == nil {
		held = map[string]bool{}
	}
	return held, release
}

// restartSiblingContainers restarts other containers that share the same
// network provider as the (shared-network-mode) upgraded container. Like the
// dependent sweep, a sibling that another operation holds an upgrade lock on is
// left alone rather than stopped mid-operation.
func (r *mutationResolver) restartSiblingContainers(ctx context.Context, rr db.RunnerRow, originalDetails map[string]any, newID string, owned map[string]bool) {
	provider := networkModeRef(jStr(jObj(originalDetails, "HostConfig"), "NetworkMode"))
	if provider == "" {
		return
	}
	list, err := runner.FetchContainers(ctx, rr)
	if err != nil {
		log.Printf("upgrade: could not list containers for sibling restart: %v", err)
		return
	}
	type sibling struct{ id, name string }
	var eligible []sibling
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
		eligible = append(eligible, sibling{id: c.ID, name: c.Name})
	}
	if len(eligible) == 0 {
		return
	}

	ids := make([]string, 0, len(eligible))
	for _, s := range eligible {
		if !owned[s.id] {
			ids = append(ids, s.id)
		}
	}
	held, release := r.claimRestartLocks(ctx, rr, ids)
	if release != nil {
		defer release()
	}
	for _, s := range eligible {
		if !owned[s.id] && !held[s.id] {
			log.Printf("upgrade: sibling %s is part of another upgrade, leaving it alone", s.name)
			continue
		}
		if err := runner.StopContainer(ctx, rr, s.id); err != nil {
			log.Printf("upgrade: failed to stop sibling %s: %v", s.name, err)
			continue
		}
		time.Sleep(1 * time.Second)
		if err := runner.StartContainer(ctx, rr, s.id); err != nil {
			log.Printf("upgrade: failed to start sibling %s: %v", s.name, err)
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

	// AutoRemove containers are removed by the engine as soon as they exit,
	// so the stop-then-recreate flow can never bring them back. Reject them
	// up front instead of destroying the container.
	if autoRemove, _ := jObj(details, "HostConfig")["AutoRemove"].(bool); autoRemove {
		return fmt.Errorf("container %s has AutoRemove enabled and cannot be upgraded in place: the engine would remove it when stopped", cleanName)
	}

	// Upgrade keeps the current tag: pull the newest digest for that tag.
	newImage := upgradeImageRef(imageName)

	// Discover dependents BEFORE any destructive operation so that a failed
	// upgrade can recreate them from their original (old-image) config instead
	// of leaving them permanently stopped or removed. Also acquire upgrade
	// locks for them: without these, a concurrent operation (stack restart,
	// another upgrade) could stop or remove a dependent while we recreate it,
	// leaving the dependency permanently broken. The target container's own
	// lock is already held by the caller.
	deps, depErr := findDependentContainers(ctx, *rr, container.ContainerID, cleanName)
	if depErr != nil {
		// Nothing has been stopped or removed yet, so refusing to proceed is
		// safe; proceeding is not.
		return fmt.Errorf("aborting upgrade of %s: %w", cleanName, depErr)
	}
	if len(deps) > 0 {
		depIDs := make([]string, 0, len(deps))
		for _, d := range deps {
			depIDs = append(depIDs, d.ID)
		}
		depLockOwner := fmt.Sprintf("pipeline-%d-%d", time.Now().UnixNano(), rand.Int63())
		_, releaseDepLocks, lockErr := r.acquireUpgradeLockSet(ctx, *rr, depLockOwner, depIDs, true)
		if lockErr != nil {
			return fmt.Errorf("acquire upgrade locks for dependent containers: %w", lockErr)
		}
		defer releaseDepLocks()
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
		// The pipeline ctx may already be canceled (client disconnect) or
		// past its deadline (stuck readiness wait): rollback must run
		// detached with its own budget or the service stays down.
		rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
		defer cancel()
		// A half-created replacement (create succeeded but start/ready
		// failed) squats on the original name: vacate it first, so BOTH
		// recovery paths below restore the pinned original image instead
		// of adopting or restarting the broken replacement.
		if newID != "" {
			if err := runner.RemoveContainer(rctx, *rr, newID, true); err != nil {
				slog.Warn("upgrade rollback: remove failed replacement failed", "container", cleanName, "error", err)
			}
		}
		if len(deps) > 0 {
			// Full recovery (provider start/recreate + dependents) lives in
			// restoreRemovedDependents.
			restoreRemovedDependents(rctx, *rr, deps, cleanName, details)
			return
		}
		// No dependents: restoreRemovedDependents would do nothing, but the
		// service itself still needs putting back — a pull failure would
		// leave it stopped forever, and a create/start failure (after
		// remove) would leave it deleted with its config only in this
		// snapshot.
		if !removed {
			if err := runner.StartContainer(rctx, *rr, container.ContainerID); err != nil {
				slog.Warn("upgrade rollback: start original container failed", "container", cleanName, "error", err)
			}
			return
		}
		origImage := jStr(details, "Image")
		if origImage == "" {
			origImage = jStr(jObj(details, "Config"), "Image")
		}
		if origImage == "" {
			origImage = imageName
		}
		origCfg, _, _ := prepareContainerConfig(details, origImage, originalName)
		id, err := runner.CreateContainer(rctx, *rr, origCfg, originalName)
		if err != nil {
			slog.Error("upgrade rollback: recreate original container failed", "container", cleanName, "error", err)
			return
		}
		if id != "" {
			if err := runner.StartContainer(rctx, *rr, id); err != nil {
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
	// IDs the pipeline already holds upgrade locks on (acquired before the
	// dependents were stopped). The recovery sweep must treat them as ours
	// rather than as contended targets.
	owned := map[string]bool{}
	if len(deps) > 0 {
		// The up-front removal deleted these dependents; the post-upgrade
		// sweep only sees containers that still exist, so recreate them
		// from their pre-stop snapshots against the new provider first.
		waitForUpgradedContainerHealth(ctx, *rr, newID)
		if err := restoreRemovedDependents(ctx, *rr, deps, cleanName, details); err != nil {
			// The provider upgrade itself succeeded and rolling it back
			// would be worse; but we removed these dependents, so the
			// operation must not report a clean success over their loss.
			return fmt.Errorf("provider %s upgraded, but dependent restore failed: %w", cleanName, err)
		}
		for _, d := range deps {
			preRestored[d.Name] = true
			owned[d.ID] = true
		}
	}
	if err := r.restartDependentContainers(ctx, *rr, newID, cleanName, container.ContainerID, stackName, shared, preRestored, owned); err != nil {
		log.Printf("upgrade %s: restart dependent containers failed: %v", cleanName, err)
		return fmt.Errorf("provider %s upgraded, but dependent recovery failed: %w", cleanName, err)
	}
	if shared {
		r.restartSiblingContainers(ctx, *rr, details, newID, owned)
	}
	return nil
}

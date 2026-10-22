package graph

import (
	"encoding/json"
	"testing"
)

// Unit tests for the config-prep helpers ported from Node's
// containerConfigService: the create payload must match Node byte-for-byte on
// the fields Docker cares about, including the JS-truthiness quirks (empty
// arrays/objects are truthy in JS and therefore kept).

func TestJsTruthy(t *testing.T) {
	cases := []struct {
		val  any
		want bool
	}{
		{nil, false},
		{false, false},
		{true, true},
		{float64(0), false},
		{float64(1), true},
		{"", false},
		{"x", true},
		{[]any{}, true},          // empty array is truthy in JS
		{map[string]any{}, true}, // empty object is truthy in JS
	}
	for _, c := range cases {
		if got := jsTruthy(c.val); got != c.want {
			t.Errorf("jsTruthy(%#v) = %v, want %v", c.val, got, c.want)
		}
	}
}

func TestCleanHostConfigForCreate(t *testing.T) {
	hc := map[string]any{
		"NetworkMode":     "bridge",
		"ContainerIDFile": "/x",
		"ResolvConfPath":  "/x",
		"HostnamePath":    "/x",
		"HostsPath":       "/x",
		"Runtime":         "runc",
		"RestartCount":    float64(0),
		"AutoRemove":      false,
		"RestartPolicy":   map[string]any{"Name": "", "MaximumRetryCount": float64(0)},
		"PortBindings":    map[string]any{"80/tcp": []any{}},
	}
	clean, shared := cleanHostConfigForCreate(hc, "c")
	if shared {
		t.Errorf("bridge network must not be shared")
	}
	for _, banned := range []string{"ContainerIDFile", "ResolvConfPath", "HostnamePath", "HostsPath", "RestartCount", "AutoRemove"} {
		if _, ok := clean[banned]; ok {
			t.Errorf("%s must be stripped", banned)
		}
	}
	// Runtime is a valid create field and carries sandbox isolation
	// (runsc/kata): it must survive recreation, not be stripped.
	if rt, _ := clean["Runtime"].(string); rt != "runc" {
		t.Errorf("Runtime must be preserved, got %v", clean["Runtime"])
	}
	if rp, _ := clean["RestartPolicy"].(map[string]any); rp == nil || rp["Name"] != "no" {
		t.Errorf("empty RestartPolicy.Name must normalize to \"no\", got %v", clean["RestartPolicy"])
	}
	if _, ok := clean["PortBindings"]; !ok {
		t.Errorf("PortBindings must be kept on a non-shared network")
	}

	// Shared network mode: ports belong to the provider, so they are dropped.
	hc2 := map[string]any{
		"NetworkMode":     "service:gluetun",
		"PortBindings":    map[string]any{"80/tcp": []any{}},
		"PublishAllPorts": true,
	}
	clean2, shared2 := cleanHostConfigForCreate(hc2, "c")
	if !shared2 {
		t.Errorf("service:* must be detected as shared")
	}
	if _, ok := clean2["PortBindings"]; ok {
		t.Errorf("PortBindings must be dropped on shared network mode")
	}
	if _, ok := clean2["PublishAllPorts"]; ok {
		t.Errorf("PublishAllPorts must be dropped on shared network mode")
	}
}

func TestPrepareNetworkingConfig(t *testing.T) {
	details := map[string]any{
		"NetworkSettings": map[string]any{
			"Networks": map[string]any{
				"mynet": map[string]any{
					"IPAMConfig": map[string]any{}, // empty object: truthy in JS, kept
					"Links":      []any{},          // empty array: truthy in JS, kept
					"Aliases":    nil,              // null: falsy, dropped
					"IPAddress":  "172.20.0.5",     // not copied: create API rejects it
				},
				"other": "not-an-object",
				// No endpoint fields at all: the old code dropped this
				// network entirely and the recreate detached it.
				"plain": map[string]any{"IPAMConfig": nil, "Links": nil, "Aliases": nil},
			},
		},
	}
	nc := prepareNetworkingConfig(details, false)
	epc, ok := nc["EndpointsConfig"].(map[string]any)
	if !ok {
		t.Fatalf("EndpointsConfig missing: %v", nc)
	}
	if len(epc) != 2 {
		t.Fatalf("non-object network entry must be skipped, object entry kept: %v", epc)
	}
	if ep, ok := epc["plain"].(map[string]any); !ok || len(ep) != 0 {
		t.Errorf("network with empty endpoint config must still be attached, got %v", epc["plain"])
	}
	ep, _ := epc["mynet"].(map[string]any)
	if ep == nil {
		t.Fatalf("mynet endpoint missing")
	}
	if _, ok := ep["IPAMConfig"].(map[string]any); !ok {
		t.Errorf("empty IPAMConfig object must be kept (JS truthy)")
	}
	if _, ok := ep["Links"].([]any); !ok {
		t.Errorf("empty Links array must be kept (JS truthy)")
	}
	if _, ok := ep["Aliases"]; ok {
		t.Errorf("null Aliases must be dropped")
	}
	if _, ok := ep["IPAddress"]; ok {
		t.Errorf("IPAddress must not be copied into the create payload")
	}

	if prepareNetworkingConfig(details, true) != nil {
		t.Errorf("shared network mode must produce no NetworkingConfig")
	}
	if prepareNetworkingConfig(map[string]any{}, false) != nil {
		t.Errorf("missing NetworkSettings must produce nil")
	}
}

func TestPrepareContainerConfig(t *testing.T) {
	details := map[string]any{
		"Name": "/app",
		"Config": map[string]any{
			"Image":        "img:1",
			"Env":          []any{"A=1"},
			"Cmd":          []any{}, // empty array: truthy in JS, kept
			"Entrypoint":   nil,     // falsy, dropped
			"WorkingDir":   "",      // empty string dropped
			"ExposedPorts": map[string]any{"80/tcp": map[string]any{}},
			"Labels": map[string]any{
				"com.docker.compose.project": "mystack",
			},
		},
		"HostConfig": map[string]any{"NetworkMode": "bridge"},
	}
	config, shared, stack := prepareContainerConfig(details, "img:2", "/app")
	if shared {
		t.Errorf("bridge is not shared")
	}
	if stack != "mystack" {
		t.Errorf("stack = %q, want mystack", stack)
	}
	if config["Image"] != "img:2" {
		t.Errorf("Image = %v, want img:2", config["Image"])
	}
	if cmd, ok := config["Cmd"].([]any); !ok || len(cmd) != 0 {
		t.Errorf("empty Cmd array must be kept (JS truthy): %v", config["Cmd"])
	}
	if _, ok := config["Entrypoint"]; ok {
		t.Errorf("null Entrypoint must be dropped")
	}
	if _, ok := config["WorkingDir"]; ok {
		t.Errorf("empty WorkingDir must be dropped")
	}
	if ep, ok := config["ExposedPorts"].(map[string]any); !ok || len(ep) != 1 {
		t.Errorf("ExposedPorts must be kept when not shared: %v", config["ExposedPorts"])
	}

	// Swarm-style stack label fallback.
	details2 := map[string]any{
		"Config": map[string]any{"Labels": map[string]any{"com.docker.stack.namespace": "swarmstack"}},
	}
	_, _, stack2 := prepareContainerConfig(details2, "img:2", "/app")
	if stack2 != "swarmstack" {
		t.Errorf("stack = %q, want swarmstack (com.docker.stack.namespace fallback)", stack2)
	}

	// Shared consumer: ExposedPorts must be dropped.
	details3 := map[string]any{
		"Config":     map[string]any{"ExposedPorts": map[string]any{"80/tcp": map[string]any{}}},
		"HostConfig": map[string]any{"NetworkMode": "container:vpn"},
	}
	config3, shared3, _ := prepareContainerConfig(details3, "img:2", "/app")
	if !shared3 {
		t.Errorf("container:* must be shared")
	}
	if _, ok := config3["ExposedPorts"]; ok {
		t.Errorf("ExposedPorts must be dropped for shared network consumers")
	}
}

// Recreated containers must keep the Config fields Docker inspects but the
// original Node port dropped: without them the new container loses its health
// check, run-as user, and stop behavior.
func TestPreservedConfigFields(t *testing.T) {
	config := map[string]any{
		"Image":       "img:1",
		"User":        "1000:1000",
		"Hostname":    "myhost",
		"Domainname":  "example.com",
		"Healthcheck": map[string]any{"Test": []any{"CMD-SHELL", "curl -f http://localhost/"}, "Interval": float64(30000000000), "Timeout": float64(5000000000)},
		"StopSignal":  "SIGUSR1",
		"StopTimeout": float64(20),
		"Tty":         true,
		"OpenStdin":   false,
		"StdinOnce":   false,
	}

	out := buildUpgradeConfig(map[string]any{"Config": config}, "img:2", nil, nil, false)
	if out["User"] != "1000:1000" {
		t.Errorf("User = %v, want 1000:1000", out["User"])
	}
	if out["Hostname"] != "myhost" || out["Domainname"] != "example.com" {
		t.Errorf("Hostname/Domainname must be preserved on standalone recreate: %v / %v", out["Hostname"], out["Domainname"])
	}
	// Docker rejects Hostname alongside a shared network mode: it must be
	// omitted there, not just optionally sent.
	sharedOut := buildUpgradeConfig(map[string]any{"Config": config}, "img:2", nil, nil, true)
	if _, ok := sharedOut["Hostname"]; ok {
		t.Errorf("Hostname must be omitted in shared network mode")
	}
	if hc, ok := out["Healthcheck"].(map[string]any); !ok || hc["StopSignal"] != nil {
		t.Errorf("Healthcheck not preserved: %v", out["Healthcheck"])
	} else if test, _ := hc["Test"].([]any); len(test) != 2 {
		t.Errorf("Healthcheck.Test mangled: %v", hc["Test"])
	}
	if out["StopSignal"] != "SIGUSR1" {
		t.Errorf("StopSignal = %v, want SIGUSR1", out["StopSignal"])
	}
	if out["StopTimeout"] != 20 {
		t.Errorf("StopTimeout = %v, want 20", out["StopTimeout"])
	}
	if out["Tty"] != true {
		t.Errorf("Tty must be preserved when true")
	}
	if _, ok := out["OpenStdin"]; ok {
		t.Errorf("false OpenStdin must not be added")
	}

	// Dependent-recreate path must preserve the same fields.
	rec := buildRecreateContainerConfig(map[string]any{"Config": config}, map[string]any{"NetworkMode": "container:abc"}, nil, true)
	if rec["User"] != "1000:1000" || rec["StopSignal"] != "SIGUSR1" {
		t.Errorf("recreate path dropped fields: %v", rec)
	}
	if _, ok := rec["Healthcheck"].(map[string]any); !ok {
		t.Errorf("recreate path dropped Healthcheck")
	}
	if _, ok := rec["Hostname"]; ok {
		t.Errorf("dependent recreate (shared net) must not send Hostname")
	}

	// Empty/absent fields must not be added.
	empty := buildUpgradeConfig(map[string]any{"Config": map[string]any{"Image": "img:1", "User": ""}}, "img:2", nil, nil, false)
	for _, k := range []string{"User", "Healthcheck", "StopSignal", "StopTimeout", "Tty"} {
		if _, ok := empty[k]; ok {
			t.Errorf("empty %s must not be added to create payload", k)
		}
	}
}

// Dependents must be recreated from the inspected image ID, not the mutable
// tag: if the tag moved in the registry meanwhile, tag-based recreation would
// silently jump the dependent to a different build.
func TestBuildRecreateContainerConfigPinsImageID(t *testing.T) {
	config := map[string]any{"Image": "linuxserver/arr:latest"}
	rec := buildRecreateContainerConfig(map[string]any{
		"Config": config,
		// Inspect documents carry the resolved image ID at top level.
		"Image": "sha256:deadbeef",
	}, map[string]any{"NetworkMode": "container:abc"}, nil, true)
	if rec["Image"] != "sha256:deadbeef" {
		t.Errorf("Image = %v, want the pinned sha256 image ID", rec["Image"])
	}
	rec = buildRecreateContainerConfig(map[string]any{"Config": config}, map[string]any{}, nil, true)
	if rec["Image"] != "linuxserver/arr:latest" {
		t.Errorf("Image = %v, want tag fallback when no ID present", rec["Image"])
	}
}

func TestUpgradeImageRef(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"lscr.io/linuxserver/tautulli:latest", "lscr.io/linuxserver/tautulli:latest"},
		{"nginx:1.24@sha256:abcdef", "nginx:1.24"},
		{"ghcr.io/foo/bar@sha256:abcdef", "ghcr.io/foo/bar:latest"},
		{"postgres", "postgres:latest"},
		// Registry host port is not a tag: no tag colon after the last slash.
		{"localhost:5000/foo/bar", "localhost:5000/foo/bar:latest"},
		{"registry.example.com:5000/img:v2", "registry.example.com:5000/img:v2"},
	}
	for _, c := range cases {
		if got := upgradeImageRef(c.in); got != c.want {
			t.Errorf("upgradeImageRef(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNetworkModeMatching(t *testing.T) {
	if networkModeRef("bridge") != "" {
		t.Errorf("bridge must not match")
	}
	if got := networkModeRef("service:gluetun"); got != "gluetun" {
		t.Errorf("service ref = %q", got)
	}
	if got := networkModeRef("container:abc"); got != "abc" {
		t.Errorf("container ref = %q", got)
	}

	const fullID = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	if !networkModeMatches("service:gluetun", "gluetun", "old", "new") {
		t.Errorf("name match failed")
	}
	if !networkModeMatches("container:"+fullID, "gluetun", fullID, "new") {
		t.Errorf("old-ID match failed")
	}
	if !networkModeMatches("container:"+fullID, "gluetun", "old", fullID) {
		t.Errorf("new-ID match failed")
	}
	if networkModeMatches("container:0123456789ab", "gluetun", "0123456789ab", "new") {
		t.Errorf("short ID must not match (64-hex required)")
	}
	if networkModeMatches("bridge", "gluetun", "old", "new") {
		t.Errorf("bridge must not match")
	}
}

func TestBuildRecreateHostConfig(t *testing.T) {
	original := map[string]any{
		"NetworkMode": "container:oldid",
		"Binds":       []any{"/data:/data"},
		// --mount volumes live here; dropping them silently strips the
		// dependent's bind/volume data on recreate.
		"Mounts":     []any{map[string]any{"Type": "bind", "Source": "/etc/cfg", "Target": "/etc/cfg"}},
		"Memory":     float64(0),       // echoed as-is; create treats 0 as default
		"CapAdd":     []any{},          // empty -> dropped
		"LogConfig":  map[string]any{}, // empty -> dropped
		"Privileged": false,            // kept as bool
		"ShmSize":    float64(0),       // echoed as-is
		"Ulimits":    nil,              // null -> dropped by empty handling? nil kept
		// The old allowlist silently dropped these; copy-and-strip must keep
		// every HostConfig field the create endpoint understands.
		"GroupAdd":  []any{"audio"},
		"NanoCpus":  float64(500000000),
		"PidsLimit": float64(100),
		"Dns":       []any{"1.1.1.1"},
		// Dependents always run in the provider's shared network mode:
		// echoing these back makes the create fail.
		"PortBindings":    map[string]any{"8080/tcp": []any{}},
		"PublishAllPorts": true,
		// Inspect bookkeeping the create endpoint rejects. Runtime is NOT
		// one of them: it is a create field and carries sandbox isolation.
		"Runtime":      "runc",
		"RestartCount": float64(3),
	}
	clean := buildRecreateHostConfig(original, "container:", "newid")
	if clean["NetworkMode"] != "container:newid" {
		t.Errorf("NetworkMode = %v, want container:newid", clean["NetworkMode"])
	}
	if rp, _ := clean["RestartPolicy"].(map[string]any); rp == nil || rp["Name"] != "unless-stopped" {
		t.Errorf("missing RestartPolicy must default to unless-stopped, got %v", clean["RestartPolicy"])
	}
	if binds, ok := clean["Binds"].([]any); !ok || len(binds) != 1 {
		t.Errorf("Binds = %v", clean["Binds"])
	}
	if mounts, ok := clean["Mounts"].([]any); !ok || len(mounts) != 1 {
		t.Errorf("Mounts must be preserved (compose --mount depends on it), got %v", clean["Mounts"])
	}
	for _, dropped := range []string{"CapAdd", "LogConfig"} {
		if _, ok := clean[dropped]; ok {
			t.Errorf("empty %s must be dropped", dropped)
		}
	}
	for _, kept := range []string{"GroupAdd", "NanoCpus", "PidsLimit", "Dns"} {
		if _, ok := clean[kept]; !ok {
			t.Errorf("%s must be preserved (allowlist used to drop it)", kept)
		}
	}
	for _, banned := range []string{"PortBindings", "PublishAllPorts", "RestartCount"} {
		if _, ok := clean[banned]; ok {
			t.Errorf("%s must be stripped from the dependent create payload", banned)
		}
	}
	if rt, _ := clean["Runtime"].(string); rt != "runc" {
		t.Errorf("Runtime must be preserved (sandbox runtimes must not be downgraded), got %v", clean["Runtime"])
	}
	if priv, ok := clean["Privileged"].(bool); !ok || priv {
		t.Errorf("Privileged must be kept as false")
	}

	// String RestartPolicy normalizes to an object; empty string falls back.
	clean2 := buildRecreateHostConfig(map[string]any{"RestartPolicy": "always"}, "service:", "x")
	if rp, _ := clean2["RestartPolicy"].(map[string]any); rp == nil || rp["Name"] != "always" {
		t.Errorf("string RestartPolicy must normalize to {Name:always}, got %v", clean2["RestartPolicy"])
	}
	clean3 := buildRecreateHostConfig(map[string]any{"RestartPolicy": ""}, "service:", "x")
	if rp, _ := clean3["RestartPolicy"].(map[string]any); rp == nil || rp["Name"] != "unless-stopped" {
		t.Errorf("empty string RestartPolicy must fall back to unless-stopped, got %v", clean3["RestartPolicy"])
	}
}

func TestRestartPolicyOr(t *testing.T) {
	if rp, _ := restartPolicyOr(nil).(map[string]any); rp["Name"] != "unless-stopped" {
		t.Errorf("nil must default to unless-stopped")
	}
	if rp, _ := restartPolicyOr("on-failure").(map[string]any); rp["Name"] != "on-failure" {
		t.Errorf("string must wrap to {Name:...}")
	}
	obj := map[string]any{"Name": "no", "MaximumRetryCount": float64(0)}
	if rp, ok := restartPolicyOr(obj).(map[string]any); !ok || rp["Name"] != "no" {
		t.Errorf("object must pass through")
	}
}

// The create payload must be JSON-serializable end to end (all decoded values
// round-trip; no Go-only types leak in).
func TestUpgradeConfigJSONRoundTrip(t *testing.T) {
	details := map[string]any{
		"Config":     map[string]any{"Env": []any{"A=1"}, "Image": "img:1"},
		"HostConfig": map[string]any{"NetworkMode": "bridge", "Memory": float64(512)},
	}
	config, _, _ := prepareContainerConfig(details, "img:2", "/app")
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var back map[string]any
	if err := json.Unmarshal(encoded, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if back["Image"] != "img:2" {
		t.Errorf("Image lost in round-trip")
	}
}

// Anonymous volumes (image VOLUME declarations) appear in inspect Mounts but
// never in HostConfig.Binds; the recreate must re-attach them as explicit
// binds or the container silently gets a fresh empty volume.
func TestPreserveAnonymousVolumes(t *testing.T) {
	details := map[string]any{
		"Mounts": []any{
			map[string]any{"Type": "bind", "Source": "/host", "Destination": "/cfg", "Mode": "rw"},
			map[string]any{"Type": "volume", "Source": "namedvol", "Destination": "/named", "Mode": "rw"},
			map[string]any{"Type": "volume", "Source": "anon123", "Destination": "/data", "Mode": "rw"},
			map[string]any{"Type": "tmpfs", "Source": "", "Destination": "/tmpfs"},
			map[string]any{"Type": "volume", "Source": "", "Destination": "/broken"},
		},
	}
	hc := map[string]any{"Binds": []any{"/host:/cfg:ro", "namedvol:/named"}}
	preserveAnonymousVolumes(details, hc)

	binds, _ := hc["Binds"].([]any)
	if len(binds) != 3 {
		t.Fatalf("binds = %v, want the original two plus the anonymous volume", binds)
	}
	if binds[2] != "anon123:/data:rw" {
		t.Errorf("anonymous bind = %v, want anon123:/data:rw", binds[2])
	}

	// No Binds at all: every volume from Mounts is re-attached (named
	// volumes normally appear in Binds; if they do not, this is the
	// safety net that keeps the data attached).
	hc2 := map[string]any{}
	preserveAnonymousVolumes(details, hc2)
	b2, _ := hc2["Binds"].([]any)
	if len(b2) != 2 || b2[0] != "namedvol:/named:rw" || b2[1] != "anon123:/data:rw" {
		t.Errorf("binds without pre-existing entries = %v, want namedvol + anon123 re-attached", b2)
	}

	// --mount volumes live in HostConfig.Mounts (copied verbatim into the
	// create payload). Re-adding one as a bind duplicates the destination
	// and Docker rejects BOTH creates, after the original is deleted.
	details3 := map[string]any{
		"Mounts": []any{
			map[string]any{"Type": "volume", "Name": "mountvol", "Source": "/var/lib/docker/volumes/mountvol/_data", "Destination": "/mv", "Mode": "rw"},
			map[string]any{"Type": "volume", "Name": "anon9", "Source": "/var/lib/docker/volumes/anon9/_data", "Destination": "/anon", "Mode": "rw"},
		},
	}
	hc3 := map[string]any{"Mounts": []any{
		map[string]any{"Type": "volume", "Source": "mountvol", "Target": "/mv", "ReadOnly": false},
	}}
	preserveAnonymousVolumes(details3, hc3)
	b3, _ := hc3["Binds"].([]any)
	if len(b3) != 1 || b3[0] != "anon9:/anon:rw" {
		t.Errorf("binds with HostConfig.Mounts = %v, want only the anonymous volume re-added", b3)
	}

	// ANONYMOUS --mount (type=volume, empty Source): echoed verbatim into
	// the create, Docker allocates a brand-new EMPTY volume and the data is
	// orphaned. The entry must be pinned to the existing volume name from
	// the inspect Mounts list.
	details4 := map[string]any{
		"Mounts": []any{
			map[string]any{"Type": "volume", "Name": "gen77", "Source": "gen77", "Destination": "/data", "Mode": "rw"},
		},
	}
	origMount := map[string]any{"Type": "volume", "Source": "", "Target": "/data", "ReadOnly": false}
	hc4 := map[string]any{"Mounts": []any{origMount}}
	preserveAnonymousVolumes(details4, hc4)
	pinned, _ := hc4["Mounts"].([]any)
	if len(pinned) != 1 {
		t.Fatalf("Mounts = %v, want the single pinned entry", pinned)
	}
	if src := jStr(pinned[0].(map[string]any), "Source"); src != "gen77" {
		t.Errorf("anonymous mount Source = %q, want pinned volume name gen77", src)
	}
	if origMount["Source"] != "" {
		t.Error("must not mutate the inspect document (shallow copy aliasing)")
	}
	if b, ok := hc4["Binds"].([]any); ok && len(b) != 0 {
		t.Errorf("pinned mount must not also be re-added as a bind: %v", b)
	}
}

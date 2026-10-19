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
	for _, banned := range []string{"ContainerIDFile", "ResolvConfPath", "HostnamePath", "HostsPath", "Runtime", "RestartCount", "AutoRemove"} {
		if _, ok := clean[banned]; ok {
			t.Errorf("%s must be stripped", banned)
		}
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
			},
		},
	}
	nc := prepareNetworkingConfig(details, false)
	epc, ok := nc["EndpointsConfig"].(map[string]any)
	if !ok {
		t.Fatalf("EndpointsConfig missing: %v", nc)
	}
	if len(epc) != 1 {
		t.Fatalf("non-object network entry must be skipped: %v", epc)
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
		"Memory":      float64(0),       // falsy -> default 0, kept as number
		"CapAdd":      []any{},          // empty -> dropped
		"LogConfig":   map[string]any{}, // empty -> dropped
		"Privileged":  false,            // falsy -> default false, kept as bool
		"ShmSize":     float64(0),       // falsy -> default 67108864
		"Ulimits":     nil,              // null -> default [] -> dropped
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
	for _, dropped := range []string{"CapAdd", "LogConfig", "Ulimits"} {
		if _, ok := clean[dropped]; ok {
			t.Errorf("empty %s must be dropped", dropped)
		}
	}
	if shm := clean["ShmSize"]; shm != 67108864 && shm != float64(67108864) {
		t.Errorf("ShmSize = %v, want default 67108864", clean["ShmSize"])
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

package registry

import "testing"

func TestParseImageName(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		imageRepo  string
		registry   string
		namespace  string
		repository string
		tag        string
	}{
		{"bare library image", "nginx", "nginx", "docker.io", "", "nginx", "latest"},
		{"bare with tag", "postgres:15", "postgres", "docker.io", "", "postgres", "15"},
		{"namespaced", "jc21/nginx-proxy-manager:latest", "jc21/nginx-proxy-manager", "docker.io", "jc21", "nginx-proxy-manager", "latest"},
		{"ghcr", "ghcr.io/home-assistant/home-assistant:stable", "ghcr.io/home-assistant/home-assistant", "ghcr.io", "home-assistant", "home-assistant", "stable"},
		{"gcr", "gcr.io/google-containers/pause:3.9", "gcr.io/google-containers/pause", "gcr.io", "google-containers", "pause", "3.9"},
		{"gitlab", "registry.gitlab.com/group/sub/project:v1", "registry.gitlab.com/group/sub/project", "registry.gitlab.com", "group", "sub/project", "v1"},
		{"quay", "quay.io/prometheus/node-exporter:v1.8.0", "quay.io/prometheus/node-exporter", "quay.io", "prometheus", "node-exporter", "v1.8.0"},
		{"lscr maps to docker.io namespace", "lscr.io/linuxserver/heimdall:latest", "lscr.io/linuxserver/heimdall", "docker.io", "lscr.io", "linuxserver/heimdall", "latest"},
		{"docker.io prefix", "docker.io/library/nginx:alpine", "library/nginx", "docker.io", "library", "nginx", "alpine"},
		// Digest suffix stripped by the canonical rule — same key SplitRepoTag
		// produces, so persisted observations correlate with live inventory.
		{"digest form", "nginx@sha256:abc123", "nginx", "docker.io", "", "nginx", "latest"},
		{"tagged digest form", "nginx:stable@sha256:abc123", "nginx", "docker.io", "", "nginx", "stable"},
		// Registry port must not be mistaken for a tag: the old split(":")
		// produced repo "localhost" with tag "5000/app".
		{"port-qualified untagged", "localhost:5000/app", "localhost:5000/app", "docker.io", "localhost:5000", "app", "latest"},
		{"port-qualified tagged", "localhost:5000/app:v2", "localhost:5000/app", "docker.io", "localhost:5000", "app", "v2"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseImageName(tc.input)
			if err != nil {
				t.Fatalf("ParseImageName(%q): unexpected error %v", tc.input, err)
			}
			if got.ImageRepo != tc.imageRepo {
				t.Errorf("ImageRepo = %q, want %q", got.ImageRepo, tc.imageRepo)
			}
			if got.Registry != tc.registry {
				t.Errorf("Registry = %q, want %q", got.Registry, tc.registry)
			}
			if got.Namespace != tc.namespace {
				t.Errorf("Namespace = %q, want %q", got.Namespace, tc.namespace)
			}
			if got.Repository != tc.repository {
				t.Errorf("Repository = %q, want %q", got.Repository, tc.repository)
			}
			if got.Tag != tc.tag {
				t.Errorf("Tag = %q, want %q", got.Tag, tc.tag)
			}
		})
	}

	if _, err := ParseImageName(""); err == nil {
		t.Error("ParseImageName(\"\") should error")
	}
}

func TestSplitRepoTag(t *testing.T) {
	tests := []struct {
		image     string
		repo, tag string
	}{
		{"nginx", "nginx", "latest"},
		{"nginx:1.25", "nginx", "1.25"},
		{"docker.io/library/nginx:alpine", "docker.io/library/nginx", "alpine"},
		// The port must stay in the repo — the old LastIndex(":") rule
		// produced repo "localhost", tag "5000/app".
		{"localhost:5000/app", "localhost:5000/app", "latest"},
		{"localhost:5000/app:v2", "localhost:5000/app", "v2"},
		{"registry.example.com:5001/team/img:1.0", "registry.example.com:5001/team/img", "1.0"},
		{"nginx@sha256:abc123", "nginx", "latest"},
		{"localhost:5000/app@sha256:abc123", "localhost:5000/app", "latest"},
	}
	for _, tc := range tests {
		repo, tag := SplitRepoTag(tc.image)
		if repo != tc.repo || tag != tc.tag {
			t.Errorf("SplitRepoTag(%q) = (%q, %q), want (%q, %q)", tc.image, repo, tag, tc.repo, tc.tag)
		}
	}
}

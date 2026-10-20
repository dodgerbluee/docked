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
		{"digest form (naive split, same as Node)", "nginx@sha256:abc123", "nginx@sha256", "docker.io", "", "nginx@sha256", "abc123"},
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

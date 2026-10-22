package config

import (
	"net"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDotenv(t *testing.T) {
	dir := t.TempDir()
	envFile := filepath.Join(dir, ".env")
	content := "# comment line\n\nJWT_SECRET=from-dotenv\nexport DATA_DIR=\"/var/lib/docked\"\nQUOTED='single quoted value'\nNOEQUALSIGN\nADDR=\":4100\"\nINLINE=value # trailing comment\nHASHY=a#b\nHASHQUOTED=\"keep # inside\"\nEMPTYQ=\"\" # after quote\n"
	if err := os.WriteFile(envFile, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ENV_FILE", envFile)

	// Real environment wins over .env (dotenv semantics).
	t.Setenv("ADDR", ":4200")

	loadDotenv()

	if got := os.Getenv("JWT_SECRET"); got != "from-dotenv" {
		t.Errorf("JWT_SECRET = %q, want from-dotenv", got)
	}
	if got := os.Getenv("DATA_DIR"); got != "/var/lib/docked" {
		t.Errorf("DATA_DIR = %q, want /var/lib/docked (quotes stripped)", got)
	}
	if got := os.Getenv("QUOTED"); got != "single quoted value" {
		t.Errorf("QUOTED = %q, want single quoted value", got)
	}
	if got := os.Getenv("ADDR"); got != ":4200" {
		t.Errorf("ADDR = %q, want :4200 (existing env must win)", got)
	}
	if _, ok := os.LookupEnv("NOEQUALSIGN"); ok {
		t.Error("line without = must be skipped")
	}
	// dotenv v16 inline-comment semantics (Node parity).
	if got := os.Getenv("INLINE"); got != "value" {
		t.Errorf("INLINE = %q, want value (unquoted inline comment stripped)", got)
	}
	if got := os.Getenv("HASHY"); got != "a" {
		t.Errorf("HASHY = %q, want a (unquoted value ends at first #)", got)
	}
	if got := os.Getenv("HASHQUOTED"); got != "keep # inside" {
		t.Errorf("HASHQUOTED = %q, want 'keep # inside' (# inside quotes preserved)", got)
	}
	if got, ok := os.LookupEnv("EMPTYQ"); !ok || got != "" {
		t.Errorf("EMPTYQ = %q (set=%v), want empty string set", got, ok)
	}
}

func TestLoadDotenvMissingFileIsNoop(t *testing.T) {
	t.Setenv("ENV_FILE", filepath.Join(t.TempDir(), "absent.env"))
	loadDotenv() // must not panic
}

func TestDBPathPrecedence(t *testing.T) {
	t.Run("DATABASE_PATH wins", func(t *testing.T) {
		t.Setenv("DATABASE_PATH", "/custom/db.sqlite")
		t.Setenv("DATA_DIR", "/ignored")
		if got := dbPath(); got != "/custom/db.sqlite" {
			t.Errorf("dbPath() = %q", got)
		}
	})
	t.Run("DATA_DIR fallback mirrors Node", func(t *testing.T) {
		os.Unsetenv("DATABASE_PATH")
		t.Setenv("DATA_DIR", "/data")
		if got := dbPath(); got != "/data/users.db" {
			t.Errorf("dbPath() = %q, want /data/users.db", got)
		}
	})
	t.Run("dev default when nothing set", func(t *testing.T) {
		os.Unsetenv("DATABASE_PATH")
		os.Unsetenv("DATA_DIR")
		// /data may exist on some machines; assert one of the two valid outcomes.
		got := dbPath()
		if got != "/data/users.db" && got != "../data/users.db" {
			t.Errorf("dbPath() = %q, want /data/users.db or ../data/users.db", got)
		}
	})
}

func TestJWTSecretEnvWins(t *testing.T) {
	t.Setenv("JWT_SECRET", "explicit-secret")
	if got := jwtSecret(); got != "explicit-secret" {
		t.Errorf("jwtSecret() = %q, want explicit-secret", got)
	}
}

func TestJWTSecretGeneratedAndPersisted(t *testing.T) {
	os.Unsetenv("JWT_SECRET")
	dir := t.TempDir()
	t.Setenv("DATA_DIR", dir)

	first := jwtSecret()
	if first == "" || first == "change-this-secret-in-production-use-strong-random-string" {
		t.Fatalf("generated secret = %q, want a strong random value", first)
	}
	if len(first) < 32 {
		t.Errorf("secret length = %d, want >= 32 hex chars", len(first))
	}
	// Same secret on a second Load (tokens must survive restarts).
	if second := jwtSecret(); second != first {
		t.Errorf("second jwtSecret() = %q, want the persisted %q", second, first)
	}
	// File exists next to the DB with owner-only perms.
	b, err := os.ReadFile(filepath.Join(dir, "jwt_secret"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != first {
		t.Errorf("file secret = %q, want %q", string(b), first)
	}
	if fi, err := os.Stat(filepath.Join(dir, "jwt_secret")); err != nil || fi.Mode().Perm() != 0o600 {
		t.Errorf("secret file perms = %v, want 0600", fi.Mode())
	}
}

func TestJWTSecretAdoptsExistingFile(t *testing.T) {
	// Cross-process first-start race: a file created concurrently by
	// another process must win over this process's freshly generated
	// secret (O_EXCL loser adopts the winner), otherwise the two processes
	// sign with divergent keys.
	os.Unsetenv("JWT_SECRET")
	dir := t.TempDir()
	t.Setenv("DATA_DIR", dir)
	if err := os.WriteFile(filepath.Join(dir, "jwt_secret"), []byte("winner-secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := jwtSecret(); got != "winner-secret" {
		t.Errorf("jwtSecret() = %q, want the pre-existing winner-secret", got)
	}
}

func TestTrustedProxies(t *testing.T) {
	t.Run("default covers loopback and private ranges", func(t *testing.T) {
		os.Unsetenv("TRUSTED_PROXIES")
		nets := trustedProxies()
		for _, ip := range []string{"127.0.0.1", "::1", "10.1.2.3", "192.168.5.6", "172.16.9.9"} {
			if !ipInAny(nets, net.ParseIP(ip)) {
				t.Errorf("default set must contain %s", ip)
			}
		}
		for _, ip := range []string{"8.8.8.8", "203.0.113.7"} {
			if ipInAny(nets, net.ParseIP(ip)) {
				t.Errorf("default set must NOT contain public %s", ip)
			}
		}
	})
	t.Run("explicit list replaces the default", func(t *testing.T) {
		t.Setenv("TRUSTED_PROXIES", "203.0.113.0/24, 198.51.100.7")
		nets := trustedProxies()
		if !ipInAny(nets, net.ParseIP("203.0.113.9")) || !ipInAny(nets, net.ParseIP("198.51.100.7")) {
			t.Fatal("explicit entries must be honored")
		}
		if ipInAny(nets, net.ParseIP("127.0.0.1")) {
			t.Error("explicit list must replace (not extend) the default")
		}
	})
	t.Run("invalid entries are skipped", func(t *testing.T) {
		t.Setenv("TRUSTED_PROXIES", "bogus, 10.0.0.0/8")
		nets := trustedProxies()
		if len(nets) != 1 || !ipInAny(nets, net.ParseIP("10.9.9.9")) {
			t.Fatalf("nets = %v, want only 10.0.0.0/8", nets)
		}
	})
}

func ipInAny(nets []*net.IPNet, ip net.IP) bool {
	for _, n := range nets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

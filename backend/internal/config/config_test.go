package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDotenv(t *testing.T) {
	dir := t.TempDir()
	envFile := filepath.Join(dir, ".env")
	content := "# comment line\n\nJWT_SECRET=from-dotenv\nexport DATA_DIR=\"/var/lib/docked\"\nQUOTED='single quoted value'\nNOEQUALSIGN\nADDR=\":4100\"\n"
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

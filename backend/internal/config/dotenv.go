package config

import (
	"bufio"
	"os"
	"strings"
)

// loadDotenv reads KEY=VALUE pairs from a .env file in the current working
// directory and applies them to the process environment. The Node backend
// loads the same file via dotenv (server/config/index.js); without this the
// Go binary would miss JWT_SECRET/DATA_DIR in deployments that supply config
// through .env instead of real environment variables.
//
// Dotenv semantics kept minimal and compatible: blank lines and #-comments
// are skipped, an optional "export " prefix is stripped, and existing
// environment variables always win (dotenv does not override the real env).
// Value parsing mirrors dotenv v16: a value starting with a quote (' " or `)
// ends at the matching close quote and everything after it (including #) is
// ignored; an unquoted value ends at the first # (inline comments like
// KEY=value # note yield "value", matching Node).
func loadDotenv() {
	path := os.Getenv("ENV_FILE")
	if path == "" {
		path = ".env"
	}
	f, err := os.Open(path)
	if err != nil {
		return // no .env file: environment is the only source, which is fine
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		val = strings.TrimSpace(val)
		if val != "" && (val[0] == '"' || val[0] == '\'' || val[0] == '`') {
			q := val[0]
			if end := strings.IndexByte(val[1:], q); end >= 0 {
				val = val[1 : 1+end]
			} else {
				val = strings.TrimPrefix(val[1:], string(q)) // unterminated quote
			}
		} else if i := strings.IndexByte(val, '#'); i >= 0 {
			val = strings.TrimSpace(val[:i])
		}
		if os.Getenv(key) == "" {
			os.Setenv(key, val)
		}
	}
}

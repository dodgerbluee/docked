package handlers

// Avatar serving routes ported from Node's avatarController.js (phase 7c):
// GET /avatars, GET /avatars/user/:userId, GET /avatars/recent and
// GET /avatars/recent/:filename. Files live in $DATA_DIR/avatars/<userId>/
// (the same layout the Go UploadAvatar mutation writes).
//
// Documented deviation: when a file is missing Node streams the bundled
// client/public/img/default-avatar.jpg; the Go binary ships no static
// assets, so it answers 404 {"success":false,"error":"Avatar not found"}.
// The client (useAvatarManagement.js, UserDetailsModal.jsx) already maps
// 404/204 to its own /img/default-avatar.jpg, so the UI is unchanged.

import (
	"database/sql"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/db"
)

// avatarsDir resolves the avatar root. Matches the graph package's
// getDataDir (DATA_DIR env or "./data"); production always sets DATA_DIR,
// which is also Node's only real configuration.
func avatarsDir() string {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "./data"
	}
	return filepath.Join(dataDir, "avatars")
}

var recentFilenameRe = regexp.MustCompile(`^[a-zA-Z0-9_-]+\.jpg$`)

// parsePositiveIDParam mirrors Node's parseInt round-trip guard: the raw
// param must be a canonical positive integer.
func parsePositiveIDParam(raw string) (int64, bool) {
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n <= 0 || strconv.FormatInt(n, 10) != raw {
		return 0, false
	}
	return n, true
}

// migrateAvatarFromUsername copies (never moves) an older username-keyed
// avatar directory into the userId-keyed one, matching Node: if the new
// directory already exists, nothing happens.
func migrateAvatarFromUsername(userID int64, oldUsername string) {
	if oldUsername == "" {
		return
	}
	root := avatarsDir()
	oldDir := filepath.Join(root, oldUsername)
	newDir := filepath.Join(root, strconv.FormatInt(userID, 10))

	if _, err := os.Stat(oldDir); err != nil {
		return
	}
	if _, err := os.Stat(newDir); err == nil {
		return
	}
	if err := os.MkdirAll(newDir, 0o755); err != nil {
		slog.Warn("avatar migration: mkdir failed", "error", err.Error())
		return
	}
	if err := copyTree(filepath.Join(oldDir, "avatar.jpg"), filepath.Join(newDir, "avatar.jpg")); err != nil && !errors.Is(err, fs.ErrNotExist) {
		slog.Warn("avatar migration: copy failed", "error", err.Error())
	}
	if err := copyTree(filepath.Join(oldDir, "recent"), filepath.Join(newDir, "recent")); err != nil && !errors.Is(err, fs.ErrNotExist) {
		slog.Warn("avatar migration: recent copy failed", "error", err.Error())
	}
}

func copyTree(src, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		data, err := os.ReadFile(src)
		if err != nil {
			return err
		}
		return os.WriteFile(dst, data, 0o644)
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := copyTree(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
			return err
		}
	}
	return nil
}

func currentUser(database *sql.DB, r *http.Request) (*db.UserRow, bool) {
	userID, ok := auth.UserID(r.Context())
	if !ok {
		return nil, false
	}
	user, err := db.GetUserByID(r.Context(), database, userID)
	if err != nil || user == nil {
		return nil, false
	}
	return user, true
}

// GetAvatar handles GET /avatars (Node's getAvatar).
func GetAvatar(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentUser(database, r)
		if !ok {
			runnerFail(w, http.StatusUnauthorized, "User ID not found")
			return
		}
		avatarPath := filepath.Join(avatarsDir(), strconv.FormatInt(user.ID, 10), "avatar.jpg")
		if _, err := os.Stat(avatarPath); err != nil {
			migrateAvatarFromUsername(user.ID, user.Username)
			if _, err := os.Stat(avatarPath); err != nil {
				runnerFail(w, http.StatusNotFound, "Avatar not found")
				return
			}
		}
		http.ServeFile(w, r, avatarPath)
	}
}

// GetAvatarByUserId handles GET /avatars/user/:userId (Node's
// getAvatarByUserId): instance-admin only.
func GetAvatarByUserId(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		caller, ok := currentUser(database, r)
		if !ok {
			runnerFail(w, http.StatusUnauthorized, "User ID not found")
			return
		}
		if caller.InstanceAdmin != 1 {
			runnerFail(w, http.StatusForbidden, "Forbidden")
			return
		}

		raw := chi.URLParam(r, "userId")
		if raw == "" {
			runnerFail(w, http.StatusBadRequest, "User ID is required")
			return
		}
		userIDNum, ok := parsePositiveIDParam(raw)
		if !ok {
			runnerFail(w, http.StatusBadRequest, "Invalid user ID")
			return
		}

		avatarPath := filepath.Join(avatarsDir(), strconv.FormatInt(userIDNum, 10), "avatar.jpg")
		if _, err := os.Stat(avatarPath); err != nil {
			runnerFail(w, http.StatusNotFound, "Avatar not found")
			return
		}
		http.ServeFile(w, r, avatarPath)
	}
}

// GetRecentAvatars handles GET /avatars/recent (Node's getRecentAvatars):
// the three newest .jpg files in the recent/ subdirectory as API URLs.
func GetRecentAvatars(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentUser(database, r)
		if !ok {
			runnerFail(w, http.StatusUnauthorized, "User ID not found")
			return
		}
		recentDir := filepath.Join(avatarsDir(), strconv.FormatInt(user.ID, 10), "recent")
		if _, err := os.Stat(recentDir); err != nil {
			migrateAvatarFromUsername(user.ID, user.Username)
			if _, err := os.Stat(recentDir); err != nil {
				runnerOK(w, http.StatusOK, map[string]any{"avatars": []string{}})
				return
			}
		}

		entries, err := os.ReadDir(recentDir)
		if err != nil {
			slog.Error("recent avatars: read failed", "error", err.Error())
			internalFail(w)
			return
		}
		type fileEntry struct {
			name  string
			mtime int64
		}
		var files []fileEntry
		for _, e := range entries {
			if e.IsDir() || len(e.Name()) < 4 || e.Name()[len(e.Name())-4:] != ".jpg" {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			files = append(files, fileEntry{name: e.Name(), mtime: info.ModTime().UnixNano()})
		}
		sort.SliceStable(files, func(i, j int) bool { return files[i].mtime > files[j].mtime })
		if len(files) > 3 {
			files = files[:3]
		}
		urls := []string{}
		for _, f := range files {
			urls = append(urls, "/api/avatars/recent/"+f.name)
		}
		runnerOK(w, http.StatusOK, map[string]any{"avatars": urls})
	}
}

// GetRecentAvatar handles GET /avatars/recent/:filename (Node's
// getRecentAvatar). The filename regex already excludes traversal; the
// numeric-userId round-trip keeps the path fully constructed from
// validated components.
func GetRecentAvatar(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentUser(database, r)
		if !ok {
			runnerFail(w, http.StatusUnauthorized, "User ID not found")
			return
		}

		filename := chi.URLParam(r, "filename")
		if !recentFilenameRe.MatchString(filename) {
			runnerFail(w, http.StatusBadRequest, "Invalid filename")
			return
		}

		safePath := filepath.Join(avatarsDir(), strconv.FormatInt(user.ID, 10), "recent", filename)
		if _, err := os.Stat(safePath); err != nil {
			migrateAvatarFromUsername(user.ID, user.Username)
			if _, err := os.Stat(safePath); err != nil {
				runnerFail(w, http.StatusNotFound, "Avatar not found")
				return
			}
		}
		http.ServeFile(w, r, safePath)
	}
}

# Settings Persistence Analysis

## Fixed: Log Level (Info/Debug) Persistence

### Issue
The log level setting in General Settings was not persisting through server restarts because the batch controller was using the in-memory logger functions instead of the DB-backed ones.

### Fix Applied
Updated `server/controllers/batchController.js` to use the DB-backed log level functions:
- `getLogLevelHandler`: Now uses `getLogLevel()` from `utils/logLevel.js` (reads from DB)
- `setLogLevelHandler`: Now uses `setLogLevel()` from `utils/logLevel.js` (saves to DB)

The log level is now stored in the `settings` table with key `'log_level'` and persists across server restarts.

## Settings Currently Stored in localStorage (Don't Persist Across Browsers/Devices)

### 1. Color Scheme Preference
- **Location**: `client/src/App.js` (lines 168-172, 361)
- **Storage**: `localStorage.getItem("colorScheme")` / `localStorage.setItem("colorScheme", ...)`
- **Values**: `"system"`, `"light"`, `"dark"`
- **Impact**: User's theme preference is lost when:
  - Using a different browser
  - Clearing browser data
  - Using a different device
- **Recommendation**: Move to DB as user preference setting

### 2. Dismissed Container Notifications
- **Location**: `client/src/App.js` (lines 61-115)
- **Storage**: `localStorage.getItem("dismissedContainerNotifications")` / `localStorage.setItem(...)`
- **Values**: Map of container ID -> dismissed version
- **Impact**: Dismissed notifications reappear when:
  - Using a different browser
  - Clearing browser data
  - Using a different device
- **Recommendation**: Move to DB as user preference (per-user dismissed notifications)

### 3. Dismissed Tracked App Notifications
- **Location**: `client/src/App.js` (lines 74-115)
- **Storage**: `localStorage.getItem("dismissedTrackedAppNotifications")` / `localStorage.setItem(...)`
- **Values**: Map of tracked app ID -> dismissed version
- **Impact**: Dismissed notifications reappear when:
  - Using a different browser
  - Clearing browser data
  - Using a different device
- **Recommendation**: Move to DB as user preference (per-user dismissed notifications)

### 4. Last Pull Time
- **Location**: `client/src/App.js` (lines 144-154, 499, 696, 1615)
- **Storage**: `localStorage.getItem("lastPullTime")` / `localStorage.setItem("lastPullTime", ...)`
- **Values**: ISO timestamp string
- **Impact**: "Last scanned" timestamp resets when:
  - Using a different browser
  - Clearing browser data
  - Using a different device
- **Recommendation**: This is already tracked in DB via batch runs. Could remove localStorage and use DB value instead.

### 5. Docker Hub Data Pulled Flag
- **Location**: `client/src/App.js` (lines 161-165, 692, 1227, 1385, 1414, 1447, 1611, 3532, 3620)
- **Storage**: `localStorage.getItem("dockerHubDataPulled")` / `localStorage.setItem("dockerHubDataPulled", ...)`
- **Values**: `true` or `false` (JSON stringified)
- **Impact**: UI state resets when:
  - Using a different browser
  - Clearing browser data
  - Using a different device
- **Recommendation**: This is a UI state flag. Could be derived from DB (check if containers have Docker Hub data) instead of storing separately.

### 6. Last Batch Initial Pull Time
- **Location**: `client/src/App.js` (lines 857-872)
- **Storage**: `localStorage.getItem("lastBatchInitialPull")` / `localStorage.setItem("lastBatchInitialPull", ...)`
- **Values**: Timestamp (milliseconds since epoch)
- **Impact**: Initial batch pull may run more frequently when:
  - Using a different browser
  - Clearing browser data
  - Using a different device
- **Recommendation**: This is a client-side throttle. Could move to DB or remove (batch system should handle this server-side).

### 7. Authentication State (Auth Token, Username, User Role, Password Changed)
- **Location**: `client/src/hooks/useAuth.js` (lines 9-31, 48, 50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126, 128, 130, 132, 134)
- **Storage**: `localStorage.getItem("authToken")`, `localStorage.getItem("username")`, `localStorage.getItem("userRole")`, `localStorage.getItem("passwordChanged")`
- **Values**: Various (token string, username string, role string, boolean)
- **Impact**: User must re-login when:
  - Using a different browser
  - Clearing browser data
  - Using a different device
- **Recommendation**: This is expected behavior for security. Keep in localStorage (session-based). However, passwordChanged flag could be stored in DB as user preference.

## Settings Currently Stored in Database (Persist Across Restarts)

### 1. Log Level ✅ (Fixed)
- **Location**: `server/db/database.js` → `settings` table, key `'log_level'`
- **API**: `GET /api/batch/log-level`, `POST /api/batch/log-level`
- **Status**: ✅ Now properly persists

### 2. Batch Configuration
- **Location**: `server/db/database.js` → `batch_configs` table
- **API**: `GET /api/batch/config`, `POST /api/batch/config`
- **Status**: ✅ Persists correctly

### 3. Portainer Instances
- **Location**: `server/db/database.js` → `portainer_instances` table
- **API**: Various endpoints in `portainerController.js`
- **Status**: ✅ Persists correctly

### 4. Docker Hub Credentials
- **Location**: `server/db/database.js` → `docker_hub_credentials` table
- **API**: `GET /api/docker-hub/credentials`, `POST /api/docker-hub/credentials`
- **Status**: ✅ Persists correctly

### 5. Tracked Images
- **Location**: `server/db/database.js` → `tracked_images` table
- **API**: Various endpoints in tracked images controller
- **Status**: ✅ Persists correctly

### 6. Discord Webhooks
- **Location**: `server/db/database.js` → `discord_webhooks` table
- **API**: Various endpoints in discord controller
- **Status**: ✅ Persists correctly

### 7. User Accounts
- **Location**: `server/db/database.js` → `users` table
- **API**: Various endpoints in auth controller
- **Status**: ✅ Persists correctly

## Recommendations for Future Improvements

### High Priority (User Experience Impact)
1. **Color Scheme Preference** → Move to DB as user setting
2. **Dismissed Notifications** → Move to DB as per-user preferences

### Medium Priority (Convenience)
3. **Last Pull Time** → Use DB batch run data instead of localStorage
4. **Docker Hub Data Pulled Flag** → Derive from DB data instead of storing separately

### Low Priority (Nice to Have)
5. **Last Batch Initial Pull Time** → Remove or move to server-side logic
6. **Password Changed Flag** → Could store in DB as user preference (but current localStorage approach is fine for security)

## Implementation Notes

The `settings` table in the database already exists and has the infrastructure to store key-value pairs:
- `getSetting(key)` - Get a setting value
- `setSetting(key, value)` - Set a setting value

This makes it easy to add new settings that need to persist across restarts.


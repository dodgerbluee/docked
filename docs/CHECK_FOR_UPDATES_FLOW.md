# "Check for Updates" Process Flow

This document describes the complete process that occurs when clicking "Check for updates" in the application. There are two different "Check for updates" buttons with different flows:

## 1. Tracked Apps Page - "Check for Updates"

### Frontend Flow

**Location:** `client/src/pages/TrackedAppsPage/components/TrackedAppsHeader.js`
- Button calls `onCheckUpdates` prop
- Which is `handleCheckTrackedAppsUpdates` from `useTrackedApps` hook

**Hook:** `client/src/hooks/useTrackedApps.js` → `handleCheckTrackedAppsUpdates`

**Process:**
1. Sets `checkingUpdates = true` (shows loading state)
2. Clears any previous errors
3. Makes POST request to `/api/tracked-apps/check-updates`
4. Waits for response
5. If successful:
   - Waits 500ms for database updates to complete
   - Calls `fetchTrackedApps()` to refresh the UI
   - Updates `lastScanTime`
   - Shows success checkmark (briefly)
6. Sets `checkingUpdates = false`

### Backend Flow

**Endpoint:** `POST /api/tracked-apps/check-updates`
**Controller:** `server/controllers/trackedAppController.js` → `checkTrackedAppsUpdates`

**Process:**
1. Validates user authentication
2. Fetches all tracked apps for the user from database:
   ```javascript
   const images = await getAllTrackedApps(userId);
   ```
3. Calls service to check all tracked apps:
   ```javascript
   const results = await trackedAppService.checkAllTrackedApps(images);
   ```
4. Returns results array

**Service:** `server/services/trackedAppService.js` → `checkAllTrackedApps`

**Process:**
1. Iterates through each tracked app
2. For each app, calls `checkTrackedApp(image, batchLogger)`
3. `checkTrackedApp` determines source type and routes to appropriate handler:
   - **GitHub:** `checkGitHubTrackedApp(trackedApp, batchLogger)`
   - **GitLab:** `checkGitLabTrackedApp(trackedApp, batchLogger)`
   - **Docker Hub:** Uses `getLatestVersionFromDockerHubTags()`

### GitHub Tracked App Check Process

**Function:** `server/services/trackedAppService.js` → `checkGitHubTrackedApp`

**Process:**
1. Extracts `github_repo` from tracked app
2. Calls GitHub API to get latest release:
   ```javascript
   latestRelease = await githubService.getLatestRelease(githubRepo);
   ```
3. Extracts `latestVersion` from release `tag_name`
4. Compares with `current_version` (normalized, removing "v" prefix):
   - Normalizes both versions
   - Sets `hasUpdate = true` if versions differ
5. If current version exists and differs from latest:
   - Fetches current version release info for publish date
6. Builds update data object:
   - `hasUpdate` (0 or 1)
   - `lastChecked` (timestamp)
   - `latestVersion` (if available)
   - `latestVersionPublishDate` (if available)
   - `currentVersionPublishDate` (if available)
7. **IMPORTANT:** Preserves existing `latestVersion` if API call fails (prevents data loss)
8. Updates database:
   ```javascript
   await updateTrackedApp(trackedApp.id, trackedApp.user_id, updateData);
   ```
9. If new update detected (wasn't previously marked as having update):
   - Logs the update
   - Sends Discord notification (if configured)
10. Returns result object with update information

### GitLab Tracked App Check Process

**Function:** `server/services/trackedAppService.js` → `checkGitLabTrackedApp`

**Process:** Similar to GitHub, but uses GitLab API:
1. Calls `gitlabService.getLatestRelease(gitlabRepo, gitlabToken)`
2. Compares versions
3. Updates database
4. Sends notifications if needed

### Docker Hub Tracked App Check Process

**Function:** `server/services/trackedAppService.js` → `checkTrackedApp` (Docker path)

**Process:**
1. Extracts image name and tag
2. Calls `getLatestVersionFromDockerHubTags(repo, userId)`:
   - Uses Docker Hub API v2 tags endpoint
   - Fetches all tags
   - Finds latest version tag (semantic versioning)
   - Gets digest for latest tag
   - Gets publish date
3. Compares digests or versions:
   - If `current_digest` exists: compares digests
   - Else if `current_version` exists: compares versions (normalized)
4. Builds update data
5. Updates database
6. Sends notifications if needed

### Database Update

**Function:** `server/db/trackedApps.js` → `updateTrackedApp`

**Process:**
1. Builds SQL UPDATE statement with provided fields
2. Updates `tracked_apps` table
3. Sets `updated_at = CURRENT_TIMESTAMP`

### Frontend Refresh

**Function:** `client/src/hooks/useTrackedApps.js` → `fetchTrackedApps`

**Process:**
1. Makes GET request to `/api/tracked-apps`
2. Backend returns all tracked apps for user
3. Formats and sorts apps alphabetically
4. Updates React state: `setTrackedApps(sortedApps)`
5. Updates `lastScanTime` from most recent `last_checked`

---

## 2. Portainer Page - "Check for Updates"

### Frontend Flow

**Location:** `client/src/pages/PortainerPage/components/PortainerHeader.js`
- Button calls `onPullDockerHub` prop
- Which is `handlePull` from `useContainerPull` hook

**Hook:** `client/src/hooks/useContainerOperations/hooks/useContainerPull.js` → `handlePull`

**Process:**
1. Sets `pulling = true` (shows loading state)
2. Clears previous errors
3. **Immediately fetches cached data** (for instant UI update):
   - GET `/api/containers?useNewCache=true&portainerOnly=true&refreshUpdates=true`
   - Updates UI with cached containers
   - Recomputes `hasUpdate` on-the-fly using `updateContainersWithPreservedState`
4. **In parallel**, starts POST request to `/api/containers/pull` (5 minute timeout)
5. When pull completes:
   - Updates containers with fresh data
   - Recomputes `hasUpdate` on-the-fly
   - Updates stacks, unused images count
   - Sets `dockerHubDataPulled = true`
   - Saves to localStorage
   - Fetches unused images
   - Shows success message
6. Sets `pulling = false`

### Backend Flow

**Endpoint:** `POST /api/containers/pull`
**Controller:** `server/controllers/containerController.js` → `pullContainers`

**Process:**
1. Validates user authentication
2. Determines if using new cache service (via query param or env var)
3. If using new cache:
   ```javascript
   result = await containerCacheService.getContainersWithCache(userId, {
     forceRefresh: true,
     portainerUrl,
   });
   ```
4. Else uses old service:
   ```javascript
   result = await containerService.getAllContainersWithUpdates(true, portainerUrl, userId);
   ```
5. Returns result with containers, stacks, portainer instances, unused images count

### New Cache Service Flow

**Service:** `server/services/cache/containerCacheService.js` → `getContainersWithCache`

**Process:**
1. Checks memory cache (TTL-based)
2. If cache valid and not forcing refresh: returns cached data
3. If forcing refresh or cache expired:
   - Fetches fresh containers from Portainer
   - Fetches cached containers from database
   - Calls `mergeAndDetectChanges()`:
     - Compares Portainer containers with database cache
     - Detects manual upgrades (digest changes)
     - Updates database with new digests
     - Merges Portainer data with cached update info
     - Computes `hasUpdate` on-the-fly for each container
   - Updates memory cache
   - Returns merged result

### Old Service Flow (if not using new cache)

**Service:** `server/services/containerQueryService.js` → `getAllContainersWithUpdates`

**Process:**
1. Gets previous containers from database (for change detection)
2. Clears registry digest cache
3. Fetches tracked apps map (for source type mapping)
4. For each Portainer instance:
   - Authenticates with Portainer
   - Fetches containers from Portainer API
   - For each container:
     - Gets container details
     - Calls `imageUpdateService.checkImageUpdates()`:
       - Determines image registry (Docker Hub, GitHub, GitLab, etc.)
       - Fetches latest digest/version from registry
       - Compares with current digest
       - Determines update source type
     - Checks network mode usage
     - Saves to database via `containerPersistenceService.saveContainerToDatabase()`
5. Groups containers by stack
6. Builds portainer instances array
7. Gets unused images count
8. Returns formatted result

### Image Update Check Process

**Service:** `server/services/imageUpdateService.js` → `checkImageUpdates`

**Process:**
1. Parses image name to determine registry
2. Routes to appropriate registry service:
   - **Docker Hub:** `dockerRegistryService.getLatestDigest()`
   - **GitHub Container Registry (ghcr.io):** `githubService.getLatestDigest()`
   - **GitLab Container Registry:** `gitlabService.getLatestDigest()`
   - **Google Container Registry:** `gcrService.getLatestDigest()`
3. Compares current digest (from container) with latest digest (from registry)
4. Determines update source type based on tracked apps map
5. Returns update information

### Database Updates

**Service:** `server/services/containerPersistenceService.js` → `saveContainerToDatabase`

**Process:**
1. Upserts container to `containers` table
2. Upserts deployed image to `deployed_images` table
3. Upserts registry image version to `registry_image_versions` table
4. Links containers to deployed images and versions

### Frontend State Update

**Function:** `client/src/utils/containerStateHelpers.js` → `updateContainersWithPreservedState`

**Process:**
1. Iterates through API containers
2. For each container:
   - Checks if it was recently successfully updated
   - If yes and no longer has update: removes from success tracking
   - Computes `hasUpdate` on-the-fly using `computeHasUpdate(container)`
   - Preserves update state for recently upgraded containers
3. Returns updated containers array
4. React state updates trigger UI re-render

---

## Key Differences

### Tracked Apps Check:
- Checks **tracked apps** (GitHub repos, GitLab repos, Docker images)
- Updates version information in `tracked_apps` table
- Does NOT check actual running containers
- Faster (only API calls to GitHub/GitLab/Docker Hub)

### Portainer Check:
- Checks **actual running containers** from Portainer
- Fetches fresh data from Portainer API
- Checks registries for each container's image
- Updates `containers`, `deployed_images`, `registry_image_versions` tables
- Slower (many API calls to Portainer and registries)
- Can use cache for faster subsequent checks

## Common Issues

1. **GitHub entries disappearing:** Fixed by preserving `latestVersion` in database even when API calls fail
2. **Stale update status:** Fixed by computing `hasUpdate` on-the-fly using digest comparison
3. **Race conditions:** Fixed by adding delays before fetching after updates complete
4. **Cache not updating:** Fixed by invalidating memory cache after database updates


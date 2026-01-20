# Fix: Duplicate Container Upgrade Detection (Multi-Arch Images)

## Issue

Users reported that containers (especially **postgres images**) were showing as having updates available even after being upgraded. The system would repeatedly try to upgrade the same container to the same version. **This issue specifically affected multi-architecture images like postgres, mysql, redis, etc.**

### Example

1. **First upgrade (Jan 16):**
   - Previous: postgres:15 (digest: `42283dfbd8b9`)
   - New: postgres:15 (digest: `7064d8f3d970`)
   - Status: Success

2. **Second upgrade (Jan 17):**
   - Previous: postgres:15 (digest: `42283dfbd8b9`) ← Same old digest!
   - New: postgres:15 (digest: `7064d8f3d970`)
   - Status: Success

The system was comparing against the OLD digest even though the container had been upgraded to the NEW digest.

## Root Cause

There were **THREE bugs** working together:

### Bug 1: Using Local Image ID Instead of Registry Digest

After upgrading a container, the code tried to get the new digest from `containerDetails.Image`:

```javascript
const imageId = newContainerDetails.Image; // ❌ This is the local image ID!
newContainerDigest = imageId;
```

**The problem**: For multi-architecture images (like postgres, mysql, redis):

- **Registry Digest** (manifest list): `sha256:7064d8f3d970...` - this is what Docker Hub returns
- **Local Image ID** (platform-specific): `sha256:42283dfbd8b9...` - this is what's on your Docker host (amd64)

The code was saving the **local image ID** into the database, but when checking for updates, it compared against the **registry digest**. They don't match! So it always looked like an update was available.

### Bug 2: Old Container Records Not Cleaned Up

When a Docker container is upgraded:

1. The old container is stopped and removed (OLD container ID)
2. A new container is created with the new image (NEW container ID)
3. The database is updated with the NEW container record

The problem was that the OLD container record remained in the database:

- Old container: `container_id=abc123`, `deployed_image_id=100` (pointing to OLD digest)
- New container: `container_id=def456`, `deployed_image_id=101` (pointing to WRONG digest due to Bug 1)

Both records coexisted, and queries could find either one.

### Bug 3: Using Wrong Database Table

The upgrade service was querying the **deprecated** `docker_hub_image_versions` table instead of the current `registry_image_versions` table:

```javascript
// ❌ OLD CODE (WRONG TABLE):
const versionInfo = await getDockerHubImageVersion(userId, imageRepo, currentTag);
// This queries the OLD docker_hub_image_versions table

// ✅ NEW CODE (CORRECT TABLE):
const versionInfo = await getRegistryImageVersion(userId, imageRepo, currentTag);
// This queries the NEW registry_image_versions table
```

The system was migrated to use `registry_image_versions` but the upgrade service wasn't updated. So even though the registry had the correct digest (`sha256:7352e0c4...`), the upgrade service couldn't find it because it was looking in the wrong table, causing `versionInfo` to be `null` and the fallback digest extraction from the container to fail as well.

## The Fix

### Fix 1: Query the Correct Database Table

Modified `server/services/containerUpgradeService.js` to use `getRegistryImageVersion()` instead of the deprecated `getDockerHubImageVersion()`:

```javascript
// Changed from:
const { getDockerHubImageVersion } = require("../db/index");
const versionInfo = await getDockerHubImageVersion(userId, imageRepo, currentTag);

// To:
const { getRegistryImageVersion } = require("../db/index");
const versionInfo = await getRegistryImageVersion(userId, imageRepo, currentTag);
```

Also updated field names to match the new table schema:

- `versionInfo.latestDigest` → `versionInfo.latest_digest`
- `versionInfo.latestVersion` → `versionInfo.latest_version`

### Fix 2: Use Registry Digest Instead of Local Image ID

Modified `server/services/containerUpgradeService.js` to use `getCurrentImageDigest()` instead of directly using the `Image` field:

```javascript
// ❌ OLD CODE (WRONG):
const imageId = newContainerDetails.Image;
newContainerDigest = imageId; // Local image ID

// ✅ NEW CODE (CORRECT):
const registryDigest = await dockerRegistryService.getCurrentImageDigest(
  newContainerDetails,
  newImageName,
  portainerUrl,
  endpointId
);
if (registryDigest) {
  newContainerDigest = registryDigest; // Registry digest from RepoDigests
}
```

`getCurrentImageDigest()` properly extracts the digest from `RepoDigests`, which contains the **registry digest** (manifest list digest for multi-arch images), not the local platform-specific image ID.

### Fix 3: Clean Up Old Container Records

Added new function `deleteOldContainersByName` in `server/db/containers.js`:

```javascript
function deleteOldContainersByName(
  userId,
  portainerInstanceId,
  endpointId,
  containerName,
  currentContainerId
)
```

This deletes any container records matching (userId, portainerInstanceId, endpointId, containerName) but with a DIFFERENT containerId.

Modified `server/services/cache/containerCacheUpdateService.js` to call this function before upserting the new container:

```javascript
// Delete old container records with the same name but different ID
await deleteOldContainersByName(
  userId,
  instance.id,
  containerData.endpointId,
  cleanContainerName,
  containerId
);

// Then upsert the new container with correct registry digest
await upsertContainerWithVersion(/* ... */);
```

## Testing

To verify the fix:

1. Upgrade a container (e.g., postgres:15)
2. Check the database - should only have ONE record for that container with the NEW digest
3. Check for updates - should NOT show an update available
4. Wait overnight and check again - should still not show an update

## Database Cleanup

After deploying this fix, you may want to clean up any existing duplicate container records:

```sql
-- Find duplicate containers (same name, endpoint, but different IDs)
SELECT container_name, endpoint_id, portainer_instance_id, COUNT(*) as count
FROM containers
GROUP BY container_name, endpoint_id, portainer_instance_id
HAVING count > 1;

-- For each duplicate found, keep only the most recent (by last_seen)
-- This can be done by triggering a full Portainer sync, which will
-- call deletePortainerContainersNotInList and remove containers
-- that no longer exist in Portainer
```

Or simply trigger a "Refresh data" in the UI to sync all containers from Portainer, which will naturally clean up old container records.

## Why This Only Affected Postgres (and Other Multi-Arch Images)

Single-architecture images (like many custom/private images) only have one image ID, so:

- Registry digest = Local image ID (they're the same)
- Bug 1 didn't matter

Multi-architecture images (postgres, mysql, redis, nginx, etc.) have:

- A **manifest list** in the registry with one digest
- Multiple **platform-specific images** (amd64, arm64, etc.) each with their own image ID
- Bug 1 caused the wrong digest to be saved

## Related Files

- `server/services/containerUpgradeService.js` - Fixed to use `getCurrentImageDigest()` for registry digest
- `server/db/containers.js` - Added `deleteOldContainersByName`
- `server/services/cache/containerCacheUpdateService.js` - Modified to delete old records before upserting
- `server/services/dockerRegistryService.js` - `getCurrentImageDigest()` extracts registry digest from RepoDigests

## Impact

- **Fixes**: Duplicate upgrade attempts for the same container
- **Benefits**:
  - Cleaner database (no duplicate container records)
  - Accurate update detection
  - Prevents unnecessary upgrade attempts
- **Risk**: Low - only affects the cleanup logic after upgrades

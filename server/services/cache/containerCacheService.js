/**
 * Container Cache Service
 *
 * Three-layer cache system for container data:
 * 1. Database Cache (persistent)
 * 2. Memory Cache (in-memory, 30s TTL)
 * 3. UI State (managed by React)
 *
 * Provides consistent, flicker-free container data with immediate updates.
 */

const logger = require("../../utils/logger");
const containerService = require("../containerService");
const { getPortainerContainersWithUpdates } = require("../../db/containers");
const { computeHasUpdate } = require("../../utils/containerUpdateHelpers");

// Memory cache with TTL
const memoryCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

/**
 * Cache entry structure
 */
class CacheEntry {
  constructor(data, timestamp = Date.now()) {
    this.data = data;
    this.timestamp = timestamp;
  }

  isStale() {
    return Date.now() - this.timestamp > CACHE_TTL;
  }
}

/**
 * Get container data with intelligent caching
 *
 * Strategy:
 * 1. Check memory cache first (if fresh)
 * 2. Fetch fresh Portainer data
 * 3. Fetch database cache
 * 4. Compare and detect changes
 * 5. Update database cache if needed
 * 6. Update memory cache
 * 7. Return merged result
 *
 * @param {number} userId - User ID
 * @param {Object} options - Options
 * @param {boolean} options.forceRefresh - Force refresh from Portainer
 * @param {string|null} options.portainerUrl - Filter by Portainer URL
 * @returns {Promise<Object>} Container data with updates
 */
async function getContainersWithCache(userId, options = {}) {
  const { forceRefresh = false, portainerUrl = null } = options;
  const cacheKey = `containers_${userId}_${portainerUrl || "all"}`;

  try {
    // Step 1: Check memory cache (if not forcing refresh)
    if (!forceRefresh) {
      const cached = memoryCache.get(cacheKey);
      if (cached && !cached.isStale()) {
        logger.debug("Using memory cache for containers", {
          userId,
          portainerUrl,
          containerCount: cached.data.containers?.length || 0,
        });
        return cached.data;
      }
    }

    // Step 2: Fetch fresh Portainer data and database cache in parallel
    logger.debug("Fetching fresh container data", { userId, portainerUrl, forceRefresh });

    const [portainerResult, dbCache] = await Promise.all([
      containerService.getContainersFromPortainer(userId),
      getPortainerContainersWithUpdates(userId, portainerUrl),
    ]);

    // Step 3: Merge and detect changes
    const merged = await mergeAndDetectChanges(
      portainerResult.containers || [],
      dbCache || [],
      userId
    );

    // Step 4: Build result
    // merged is an array of containers from mergeAndDetectChanges
    // Ensure merged is always an array
    const mergedContainers = Array.isArray(merged) ? merged : merged?.containers || [];

    // Log summary of containers with updates for debugging
    const containersWithUpdates = mergedContainers.filter((c) => c.hasUpdate);
    logger.debug("Merged containers summary", {
      total: mergedContainers.length,
      withUpdates: containersWithUpdates.length,
      withoutUpdates: mergedContainers.length - containersWithUpdates.length,
    });

    const result = {
      grouped: true,
      stacks: portainerResult.stacks || [],
      containers: mergedContainers,
      portainerInstances: portainerResult.portainerInstances || [],
      unusedImagesCount: portainerResult.unusedImagesCount || 0,
    };

    // Step 5: Update memory cache
    memoryCache.set(cacheKey, new CacheEntry(result));

    return result;
  } catch (error) {
    logger.error("Error in getContainersWithCache:", error);

    // Fallback to database cache if Portainer fetch fails
    try {
      const dbCache = await getPortainerContainersWithUpdates(userId, portainerUrl);
      if (dbCache && dbCache.length > 0) {
        logger.warn("Falling back to database cache due to Portainer error", {
          userId,
          portainerUrl,
          containerCount: dbCache.length,
        });

        // Format database cache to match expected structure
        const { groupContainersByStackWithUnstacked } = require("../containerGroupingService");
        const { stacks } = groupContainersByStackWithUnstacked(dbCache, "Unstacked");

        return {
          grouped: true,
          stacks,
          containers: dbCache,
          portainerInstances: [],
          unusedImagesCount: 0,
        };
      }
    } catch (fallbackError) {
      logger.error("Fallback to database cache also failed:", fallbackError);
    }

    // Last resort: return empty result
    return {
      grouped: true,
      stacks: [],
      containers: [],
      portainerInstances: [],
      unusedImagesCount: 0,
    };
  }
}

/**
 * Merge fresh Portainer data with database cache and detect changes
 *
 * @param {Array} portainerContainers - Fresh containers from Portainer
 * @param {Array} dbContainers - Cached containers from database
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Merged containers with change detection
 */
async function mergeAndDetectChanges(portainerContainers, dbContainers, userId) {
  const dbMap = new Map();
  const dbMapByImage = new Map(); // Map by image name for fallback matching

  // Database containers: id = DB row ID, containerId = actual container ID
  // Portainer containers: id = actual container ID
  // So we need to map portainerContainer.id to dbContainer.containerId
  dbContainers.forEach((c) => {
    // Map by containerId (the actual container ID from Docker/Portainer)
    if (c.containerId) {
      dbMap.set(c.containerId, c);
      // Also map by short ID (first 12 chars) for compatibility
      if (c.containerId.length >= 12) {
        dbMap.set(c.containerId.substring(0, 12), c);
      }
    }
    // Also map by id in case some containers use id as container ID
    if (c.id && c.id !== c.containerId) {
      dbMap.set(c.id, c);
    }
    // Map by image name for fallback matching (when container ID changes after upgrade)
    if (c.imageName) {
      const imageKey = `${c.imageName}_${c.endpointId || ""}`;
      if (!dbMapByImage.has(imageKey)) {
        dbMapByImage.set(imageKey, c);
      }
    }
  });

  const changes = [];
  const merged = [];

  for (const portainerContainer of portainerContainers) {
    // portainerContainer.id is the actual container ID
    let dbContainer = dbMap.get(portainerContainer.id);

    // If not found by exact ID, try short ID
    if (!dbContainer && portainerContainer.id.length >= 12) {
      dbContainer = dbMap.get(portainerContainer.id.substring(0, 12));
    }

    // If still not found, try matching by image name (container might have been recreated)
    if (!dbContainer && portainerContainer.image) {
      const imageKey = `${portainerContainer.image}_${portainerContainer.endpointId || ""}`;
      dbContainer = dbMapByImage.get(imageKey);
    }

    if (dbContainer) {
      // Compare current digests to detect manual upgrades
      const freshDigest = normalizeDigest(
        portainerContainer.currentDigest || portainerContainer.currentDigestFull
      );
      const cachedDigest = normalizeDigest(
        dbContainer.currentDigest || dbContainer.currentDigestFull
      );

      // If digests differ, container was manually upgraded
      if (freshDigest && cachedDigest && freshDigest !== cachedDigest) {
        changes.push({
          containerId: portainerContainer.id,
          containerName: portainerContainer.name,
          oldDigest: cachedDigest,
          newDigest: freshDigest,
          type: "manual_upgrade",
        });

        // Update database cache with new digest
        await updateContainerDigestInCache(
          userId,
          portainerContainer.id,
          freshDigest,
          portainerContainer.currentDigestFull || portainerContainer.currentDigest
        );
      }

      // Merge: use fresh Portainer data for status/state, preserve update info from cache
      // Database container has: containerId, containerName, userId, portainerInstanceId (internal DB fields)
      // Portainer container has: id, name (frontend fields)
      // Build clean container object with correct field names for frontend
      const mergedContainer = {
        // Use Portainer container ID and name (fresh data)
        id: portainerContainer.id, // Use Portainer ID (actual container ID)
        name: portainerContainer.name, // Use Portainer name (fresh)
        image: portainerContainer.image || dbContainer.imageName,
        status: portainerContainer.status,
        state: portainerContainer.state,
        endpointId: portainerContainer.endpointId || dbContainer.endpointId,
        portainerUrl: portainerContainer.portainerUrl,
        portainerName: portainerContainer.portainerName,
        usesNetworkMode:
          portainerContainer.usesNetworkMode !== undefined
            ? portainerContainer.usesNetworkMode
            : dbContainer.usesNetworkMode,
        providesNetwork:
          portainerContainer.providesNetwork !== undefined
            ? portainerContainer.providesNetwork
            : dbContainer.providesNetwork,
        // CRITICAL: Use fresh currentDigest (detects manual upgrades)
        // Prioritize Portainer currentDigest, but fall back to cached if Portainer doesn't have it
        currentDigest:
          portainerContainer.currentDigest ||
          portainerContainer.currentDigestFull ||
          dbContainer.currentDigest,
        currentDigestFull:
          portainerContainer.currentDigestFull ||
          portainerContainer.currentDigest ||
          dbContainer.currentDigest ||
          dbContainer.currentDigestFull,
        currentTag: portainerContainer.currentTag || dbContainer.currentTag || dbContainer.imageTag,
        currentVersion:
          portainerContainer.currentVersion || dbContainer.currentVersion || dbContainer.currentTag,
        currentImageCreated:
          portainerContainer.currentImageCreated ||
          dbContainer.currentImageCreated ||
          dbContainer.imageCreatedDate,
        // Preserve update-related fields from cache
        // CRITICAL: Database only has latestDigest (not latestDigestFull), so use it for both
        // This ensures computeHasUpdate can find the digest in either field
        latestDigest: dbContainer.latestDigest || null,
        latestDigestFull: dbContainer.latestDigestFull || dbContainer.latestDigest || null,
        latestTag: dbContainer.latestTag,
        latestVersion: dbContainer.latestVersion,
        newVersion: dbContainer.newVersion,
        latestPublishDate: dbContainer.latestPublishDate,
        imageRepo: dbContainer.imageRepo || portainerContainer.imageRepo,
        stackName: portainerContainer.stackName || dbContainer.stackName,
        existsInDockerHub: dbContainer.existsInDockerHub,
        provider: dbContainer.provider,
        updateSourceType: dbContainer.updateSourceType,
        updateGitHubRepo: dbContainer.updateGitHubRepo,
        updateGitLabRepo: dbContainer.updateGitLabRepo,
        noDigest: dbContainer.noDigest,
        lastChecked: dbContainer.lastChecked,
      };

      // Compute hasUpdate on-the-fly with fresh currentDigest
      mergedContainer.hasUpdate = computeHasUpdate(mergedContainer);

      // Debug logging for missing updates - log ALL containers with latestDigest to see what's happening
      if (dbContainer.latestDigest) {
        const currentNorm = normalizeDigest(
          mergedContainer.currentDigest || mergedContainer.currentDigestFull
        );
        const latestNorm = normalizeDigest(
          dbContainer.latestDigest || dbContainer.latestDigestFull
        );
        const shouldHaveUpdate = currentNorm && latestNorm && currentNorm !== latestNorm;

        if (shouldHaveUpdate && !mergedContainer.hasUpdate) {
          // This should have hasUpdate=true but doesn't - log for debugging
          logger.warn("Container should have update but computeHasUpdate returned false", {
            containerName: mergedContainer.name,
            containerId: mergedContainer.id.substring(0, 12),
            currentDigest: currentNorm ? currentNorm.substring(0, 12) : "null",
            latestDigest: latestNorm ? latestNorm.substring(0, 12) : "null",
            currentDigestFull:
              mergedContainer.currentDigest || mergedContainer.currentDigestFull || "null",
            latestDigestFull: dbContainer.latestDigest || dbContainer.latestDigestFull || "null",
            provider: dbContainer.provider,
            hasCurrentDigest: !!mergedContainer.currentDigest,
            hasCurrentDigestFull: !!mergedContainer.currentDigestFull,
            hasLatestDigest: !!mergedContainer.latestDigest,
            hasLatestDigestFull: !!mergedContainer.latestDigestFull,
          });
        }
      } else if (!dbContainer.latestDigest && mergedContainer.hasUpdate) {
        // Container has update but no latestDigest in cache - this shouldn't happen
        logger.warn("Container has update but no latestDigest in cache", {
          containerName: mergedContainer.name,
          containerId: mergedContainer.id.substring(0, 12),
        });
      }

      merged.push(mergedContainer);
    } else {
      // Container not found by ID - might be recreated or new
      // Try to find update info by image name (container might have been recreated with new ID)
      let updateInfoFromImage = null;
      if (portainerContainer.image) {
        const imageKey = `${portainerContainer.image}_${portainerContainer.endpointId || ""}`;
        updateInfoFromImage = dbMapByImage.get(imageKey);
      }

      if (updateInfoFromImage) {
        // We have update info from a previous container with the same image
        // This handles cases where container was recreated (new ID) but same image
        const containerWithUpdates = {
          ...portainerContainer,
          // Preserve update-related fields from the matched container
          // CRITICAL: Database only has latestDigest (not latestDigestFull), so use it for both
          latestDigest: updateInfoFromImage.latestDigest || null,
          latestDigestFull:
            updateInfoFromImage.latestDigestFull || updateInfoFromImage.latestDigest || null,
          latestTag: updateInfoFromImage.latestTag,
          latestVersion: updateInfoFromImage.latestVersion,
          newVersion: updateInfoFromImage.newVersion,
          latestPublishDate: updateInfoFromImage.latestPublishDate,
          imageRepo: updateInfoFromImage.imageRepo || portainerContainer.imageRepo,
          existsInDockerHub: updateInfoFromImage.existsInDockerHub,
          provider: updateInfoFromImage.provider,
          updateSourceType: updateInfoFromImage.updateSourceType,
          updateGitHubRepo: updateInfoFromImage.updateGitHubRepo,
          updateGitLabRepo: updateInfoFromImage.updateGitLabRepo,
          noDigest: updateInfoFromImage.noDigest,
          lastChecked: updateInfoFromImage.lastChecked,
        };

        // Compute hasUpdate with the update info
        containerWithUpdates.hasUpdate = computeHasUpdate(containerWithUpdates);
        merged.push(containerWithUpdates);
      } else {
        // Truly new container - no update info available
        merged.push(portainerContainer);
      }
    }
  }

  // Log changes if any
  if (changes.length > 0) {
    logger.info("Detected container changes", {
      userId,
      changeCount: changes.length,
      changes: changes.map((c) => ({
        name: c.containerName,
        type: c.type,
      })),
    });
  }

  return merged; // Return just the containers array for compatibility
}

/**
 * Update container digest in database cache
 *
 * @param {number} userId - User ID
 * @param {string} containerId - Container ID
 * @param {string} newDigest - New digest (normalized)
 * @param {string} newDigestFull - New full digest
 * @returns {Promise<void>}
 */
async function updateContainerDigestInCache(userId, containerId, newDigest, newDigestFull) {
  try {
    const { upsertContainerWithVersion } = require("../../db/containers");
    const { getAllPortainerInstances } = require("../../db/portainerInstances");

    // Find container in database to get instance ID
    const dbContainers = await getPortainerContainersWithUpdates(userId);
    // Try to find by containerId first (actual container ID), then by id (DB row ID)
    let container = dbContainers.find((c) => c.containerId === containerId);
    if (!container) {
      container = dbContainers.find((c) => c.id === containerId);
    }
    // Also try short ID match
    if (!container && containerId.length >= 12) {
      container = dbContainers.find(
        (c) =>
          (c.containerId && c.containerId.substring(0, 12) === containerId.substring(0, 12)) ||
          (c.id && c.id.substring(0, 12) === containerId.substring(0, 12))
      );
    }

    if (!container) {
      logger.debug("Container not found in cache, skipping digest update", { containerId });
      return;
    }

    // Get Portainer instance
    const instances = await getAllPortainerInstances(userId);
    const instance = instances.find((inst) => inst.id === container.portainerInstanceId);

    if (!instance) {
      logger.warn("Portainer instance not found for container", { containerId });
      return;
    }

    // Update cache with new digest
    await upsertContainerWithVersion(
      userId,
      instance.id,
      {
        containerId: container.containerId,
        containerName: container.containerName,
        endpointId: container.endpointId,
        imageName: container.imageName,
        imageRepo: container.imageRepo,
        status: container.status,
        state: container.state,
        stackName: container.stackName,
        currentDigest: newDigestFull || newDigest,
        imageCreatedDate: container.imageCreatedDate,
        usesNetworkMode: container.usesNetworkMode,
        providesNetwork: container.providesNetwork,
      },
      null // No version data update needed
    );

    logger.debug("Updated container digest in cache", {
      containerId: containerId.substring(0, 12),
      containerName: container.containerName,
    });
  } catch (error) {
    logger.error("Error updating container digest in cache:", error);
    // Don't throw - cache update failure shouldn't break the flow
  }
}

/**
 * Normalize digest for comparison
 *
 * @param {string|null} digest - Digest string
 * @returns {string|null} Normalized digest
 */
function normalizeDigest(digest) {
  if (!digest) return null;
  // Remove sha256: prefix if present, convert to lowercase, trim whitespace
  return String(digest)
    .replace(/^sha256:/i, "")
    .toLowerCase()
    .trim();
}

/**
 * Invalidate memory cache for a container or all containers
 *
 * @param {number} userId - User ID
 * @param {string|null} containerId - Container ID (null for all)
 * @param {string|null} portainerUrl - Portainer URL (null for all)
 */
function invalidateCache(userId, containerId = null, portainerUrl = null) {
  if (containerId) {
    // Invalidate specific container - clear all cache entries for this user
    const keys = Array.from(memoryCache.keys());
    keys.forEach((key) => {
      if (key.includes(`_${userId}_`)) {
        memoryCache.delete(key);
      }
    });
  } else if (portainerUrl) {
    // Invalidate cache for specific Portainer URL
    const cacheKey = `containers_${userId}_${portainerUrl}`;
    memoryCache.delete(cacheKey);
    // Also clear the "all" cache for this user
    const allCacheKey = `containers_${userId}_all`;
    memoryCache.delete(allCacheKey);
  } else {
    // Invalidate all cache entries for this user (no containerId, no portainerUrl)
    const keys = Array.from(memoryCache.keys());
    keys.forEach((key) => {
      if (key.startsWith(`containers_${userId}_`)) {
        memoryCache.delete(key);
      }
    });
  }

  logger.debug("Invalidated memory cache", { userId, containerId, portainerUrl });
}

/**
 * Clear all memory cache
 */
function clearMemoryCache() {
  memoryCache.clear();
  logger.debug("Cleared all memory cache");
}

module.exports = {
  getContainersWithCache,
  invalidateCache,
  clearMemoryCache,
  mergeAndDetectChanges,
};

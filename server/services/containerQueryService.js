/**
 * Container Query Service
 * Handles container querying and retrieval operations
 */

const { URL } = require("url");
const portainerService = require("./portainerService");
const dockerRegistryService = require("./dockerRegistryService");
const registryService = require("./registry"); // New unified registry service with provider caches
const networkModeService = require("./networkModeService");
const containerGroupingService = require("./containerGroupingService");
const containerFormattingService = require("./containerFormattingService");
const containerNotificationService = require("./containerNotificationService");
const containerProcessingService = require("./containerProcessingService");
const containerDataService = require("./containerDataService");
const containerQueryOrchestrationService = require("./containerQueryOrchestrationService");
const { getAllSourceInstances, getAllTrackedApps } = require("../db/index");
const { getAllRunners } = require("../db/runners");
const runnerDockerService = require("./runnerDockerService");
const logger = require("../utils/logger");

/**
 * Get all containers with update status from all Portainer instances
 * @returns {Promise<Object>} - Containers grouped by stack
 */
/**
 * Get all containers with update status
 * @param {boolean} forceRefresh - If true, bypass cache and fetch fresh data
 * @returns {Promise<Object>} - Containers with update information
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Container query requires comprehensive data aggregation logic
async function getAllContainersWithUpdates(
  forceRefresh = false,
  filterSourceUrl = null,
  userId = null,
  batchLogger = null
) {
  // Get previous data from normalized tables to compare for newly detected updates
  let previousContainers = null;
  if (forceRefresh && userId) {
    const { getContainersWithUpdates } = require("../db/index");
    previousContainers = await getContainersWithUpdates(userId);
    // Clear ALL registry digest caches to ensure fresh data when force refreshing
    // This prevents stale cached digests from causing false positives when containers
    // were updated outside the app (e.g., manually via Portainer or docker pull)
    // CRITICAL: Clear both old dockerRegistryService cache AND new registry provider caches
    dockerRegistryService.clearAllDigestCache(); // Old service cache
    registryService.clearAllCaches(); // New service: clears DockerHub, GHCR, GitLab, GCR provider caches
    logger.info("🗑️  Cleared all registry digest caches for force refresh");
  }

  // Get tracked apps to determine update source type (GitHub vs GitLab vs Registry)
  // Create a map of imageRepo -> { source_type, github_repo, gitlab_repo } for quick lookup
  let trackedAppsMap = new Map();
  if (userId) {
    try {
      const trackedApps = await getAllTrackedApps(userId);
      trackedAppsMap = containerFormattingService.buildTrackedAppsMap(trackedApps);
    } catch (error) {
      logger.debug("Error fetching tracked apps for source type mapping:", error);
    }
  }

  // Check cache first unless force refresh is requested
  if (!forceRefresh) {
    // If userId is provided, try to use normalized tables first (per-user data)
    if (userId) {
      const dbContainers = require("../db/containers");
      const normalizedContainers = await dbContainers.getContainersWithUpdates(userId);

      if (normalizedContainers && normalizedContainers.length > 0) {
        // We have data in normalized tables - format it for the frontend
        const userInstances = await getAllSourceInstances(userId);

        // Create instance map for quick lookup
        const instanceMap = new Map(userInstances.map((inst) => [inst.id, inst]));

        // Format containers to match expected structure
        const formattedContainers = normalizedContainers.map((c) => {
          const instance = instanceMap.get(c.sourceInstanceId);
          return containerFormattingService.formatContainerFromDatabase(
            c,
            instance,
            trackedAppsMap
          );
        });

        // Group containers by stack
        const { stacks } = containerGroupingService.groupContainersByStackWithUnstacked(
          formattedContainers,
          "Unstacked"
        );

        // Build sourceInstances array
        const sourceInstancesArray = containerDataService.buildSourceInstancesArray(
          formattedContainers,
          userInstances
        );

        // Get unused images count
        const unusedImages = await getUnusedImages(userId);
        const unusedImagesCount = unusedImages.length;

        return {
          grouped: true,
          stacks,
          containers: formattedContainers,
          sourceInstances: sourceInstancesArray,
          unusedImagesCount,
        };
      }
    }

    // No normalized data found - return empty result instead of fetching from registries
    // User must explicitly click "Pull" or batch process must run to fetch fresh data
    if (process.env.DEBUG) {
      logger.debug(
        'No normalized data found, returning empty result. User must click "Pull" to fetch data.'
      );
    }
    // IMPORTANT: Do NOT call registries here - only return empty result
    return {
      grouped: true,
      stacks: [],
      containers: [],
      sourceInstances: [],
      unusedImagesCount: 0,
    };
  }
  // Only when forceRefresh=true (explicit pull request or batch process)
  if (filterSourceUrl) {
    logger.info(
      `Force refresh requested for instance ${filterSourceUrl}, fetching fresh data from registries...`
    );
  } else {
    logger.info("Force refresh requested, fetching fresh data from registries...");
  }
  // Don't clear cache immediately - keep old data visible until new data is ready
  // Cache will be replaced when new data is saved

  const allContainers = [];

  // Get Portainer instances to process
  const instancesToProcess =
    await containerQueryOrchestrationService.getPortainerInstancesToProcess(
      userId,
      filterSourceUrl
    );

  logger.info(
    `🔍 Force refresh: Found ${instancesToProcess.length} Portainer instances to process`,
    { userId, filterSourceUrl, instanceCount: instancesToProcess.length }
  );

  if (instancesToProcess.length === 0) {
    logger.warn("⚠️  No Portainer instances found to process - returning empty result", {
      userId,
      filterSourceUrl,
    });
    // Return empty result
    return {
      grouped: true,
      stacks: [],
      containers: [],
      sourceInstances: [],
      unusedImagesCount: 0,
    };
  }

  // Get sourceInstances for result building
  const sourceInstances = filterSourceUrl
    ? instancesToProcess
    : await getAllSourceInstances(userId);

  // If filtering by specific instance, get existing data from normalized tables to merge with
  let existingContainers = null;
  if (filterSourceUrl && previousContainers) {
    existingContainers = previousContainers;
  }

  // Fetch containers from Portainer instances (filtered if specified)
  for (let instanceIndex = 0; instanceIndex < instancesToProcess.length; instanceIndex++) {
    const instance = instancesToProcess[instanceIndex];
    const portainerUrl = instance.url || instance;
    const instanceName =
      instance.name ||
      (typeof instance === "string" ? new URL(instance).hostname : new URL(portainerUrl).hostname);
    const { username } = instance;
    const { password } = instance;

    try {
      await portainerService.authenticatePortainer({
        portainerUrl,
        username,
        password,
      });
      const endpoints = await portainerService.getEndpoints(portainerUrl);

      if (endpoints.length === 0) {
        logger.warn(`No endpoints found for ${portainerUrl}`);
        continue;
      }

      // Use first endpoint for each Portainer instance
      const endpointId = endpoints[0].Id;
      const containers = await portainerService.getContainers(portainerUrl, endpointId);

      // Track current container IDs for this instance to clean up deleted containers later
      const currentContainerIds = new Set(containers.map((c) => c.Id));

      // Detect network mode relationships
      const { containerNetworkModes } = await networkModeService.detectNetworkModes(
        containers,
        portainerUrl,
        endpointId
      );

      // Process containers in parallel for speed
      const containersWithUpdates = await Promise.all(
        containers.map(async (container) => {
          try {
            return containerProcessingService.processContainer({
              container,
              portainerUrl,
              endpointId,
              instance,
              instanceName,
              containerNetworkModes,
              userId,
              trackedAppsMap,
            });
          } catch (error) {
            // If rate limit exceeded, propagate the error immediately
            if (error.isRateLimitExceeded) {
              throw error;
            }
            // Error handling is done in processContainer, but we need to handle rate limit here
            throw error;
          }
        })
      );

      allContainers.push(...containersWithUpdates);

      // Clean up containers that no longer exist (were deleted from Portainer)
      // This ensures the database only contains containers that actually exist
      // Safety check: skip cleanup if Portainer returned suspiciously few containers
      // (could indicate a transient API failure returning a partial list)
      if (userId && instance.id && currentContainerIds.size > 0) {
        try {
          const {
            deleteContainersNotInList,
            getContainerCountForInstance,
          } = require("../db/index");

          // Check how many containers are currently in the DB for this instance
          const dbCount = await getContainerCountForInstance(userId, instance.id, endpointId);

          // If Portainer returned less than half the DB count, and DB has a reasonable
          // number of containers, skip cleanup to prevent data loss from transient issues
          const liveCount = currentContainerIds.size;
          if (dbCount > 4 && liveCount < dbCount * 0.5) {
            logger.warn(
              `Skipping container cleanup for ${instanceName}: Portainer returned ${liveCount} containers but DB has ${dbCount}. Possible transient API issue.`,
              {
                module: "containerQueryService",
                operation: "getAllContainersWithUpdates",
                portainerUrl,
                instanceId: instance.id,
                liveCount,
                dbCount,
              }
            );
          } else {
            const deletedCount = await deleteContainersNotInList(
              userId,
              instance.id,
              endpointId,
              Array.from(currentContainerIds)
            );
            const hasDeletedContainers = deletedCount > 0;
            if (hasDeletedContainers) {
              logger.debug(
                `Cleaned up ${deletedCount} deleted container(s) from database for ${instanceName}`,
                {
                  module: "containerQueryService",
                  operation: "getAllContainersWithUpdates",
                  portainerUrl,
                  instanceId: instance.id,
                }
              );

              // Clean up orphaned deployed images after container deletion
              const cleanupOrphanedImages = async () => {
                try {
                  const { cleanupOrphanedDeployedImages } = require("../db/index");
                  const orphanedImages = await cleanupOrphanedDeployedImages(userId);
                  if (orphanedImages > 0) {
                    logger.debug(
                      `Cleaned up ${orphanedImages} orphaned deployed image(s) for ${instanceName}`
                    );
                  }
                } catch (cleanupErr) {
                  logger.warn("Error cleaning up orphaned deployed images:", cleanupErr);
                }
              };
              await cleanupOrphanedImages();
            }
          }
        } catch (cleanupError) {
          // Don't fail the entire fetch if cleanup fails
          logger.warn("Error cleaning up deleted containers:", { error: cleanupError });
        }
      }

      // Clean up orphaned registry versions after all instances processed
      if (userId && instanceIndex === instancesToProcess.length - 1) {
        try {
          const { cleanupOrphanedRegistryVersions } = require("../db/index");
          const orphanedVersions = await cleanupOrphanedRegistryVersions(userId);
          const hasOrphanedVersions = orphanedVersions > 0;
          if (hasOrphanedVersions) {
            logger.debug(
              `Cleaned up ${orphanedVersions} orphaned registry version(s) for user ${userId}`
            );
          }
        } catch (cleanupErr) {
          logger.warn("Error cleaning up orphaned registry versions:", cleanupErr);
        }
      }
    } catch (error) {
      // If rate limit exceeded, propagate the error immediately
      if (error.isRateLimitExceeded) {
        throw error;
      }
      logger.error(`Error fetching containers from ${portainerUrl}:`, { error });
      // Fall back to DB-cached containers for this instance so they don't vanish
      if (userId && instance.id) {
        try {
          const dbContainers = require("../db/containers");
          const cachedContainers = await dbContainers.getContainersWithUpdates(
            userId,
            portainerUrl
          );
          if (cachedContainers && cachedContainers.length > 0) {
            const formatted = cachedContainers.map((c) => {
              return containerFormattingService.formatContainerFromDatabase(
                c,
                instance,
                trackedAppsMap
              );
            });
            allContainers.push(...formatted);
            logger.warn(
              `Falling back to ${formatted.length} DB-cached containers for ${instanceName}`,
              { module: "containerQueryService", portainerUrl }
            );
          }
        } catch (fallbackErr) {
          logger.warn("DB fallback also failed for instance:", {
            portainerUrl,
            error: fallbackErr,
          });
        }
      }
      // Continue with other Portainer instances even if one fails
    }
  }

  // Group containers by stack
  const groupedContainers = containerGroupingService.groupContainersByStack(
    allContainers,
    "Standalone"
  );

  // Declare unusedImagesCount variable
  let unusedImagesCount = 0;

  // If filtering by specific instance, merge with existing data from normalized tables
  if (filterSourceUrl && existingContainers) {
    // Merge container data
    allContainers = await containerDataService.mergeContainerData(
      allContainers,
      existingContainers,
      userId,
      filterSourceUrl,
      trackedAppsMap
    );

    // Re-group containers by stack
    const mergedGroupedContainers = containerGroupingService.groupContainersByStack(
      allContainers,
      "Standalone"
    );

    // Update groupedContainers with merged data
    groupedContainers.length = 0;
    groupedContainers.push(...mergedGroupedContainers);

    // Recalculate unused images count (we don't store this in normalized tables)
    unusedImagesCount = 0;
  } else {
    // Get unused images count for all instances
    const counts = await Promise.all(
      sourceInstances.map(async (instance) => {
        const portainerUrl = instance.url || instance;
        const { username } = instance;
        const { password } = instance;
        const apiKey = instance.api_key;
        const authType = instance.auth_type || "apikey";

        try {
          await portainerService.authenticatePortainer({
            portainerUrl,
            username,
            password,
            apiKey,
            authType,
          });
          const endpoints = await portainerService.getEndpoints(portainerUrl);
          if (endpoints.length === 0) {
            return 0;
          }

          const endpointId = endpoints[0].Id;
          return await containerDataService.countUnusedImages(portainerUrl, endpointId);
        } catch (error) {
          logger.error(`Error counting unused images from ${portainerUrl}:`, { error });
          return 0;
        }
      })
    );

    unusedImagesCount = counts.reduce((acc, count) => acc + count, 0);
  }

  // Build sourceInstances array for frontend
  const sourceInstancesArray = containerDataService.buildSourceInstancesArray(
    allContainers,
    sourceInstances
  );

  const result = {
    grouped: true,
    stacks: groupedContainers,
    containers: allContainers,
    sourceInstances: sourceInstancesArray,
    unusedImagesCount,
  };

  // Data is already saved to normalized tables during container processing
  // No need to save to cache anymore

  // Send Discord notifications for newly detected container updates
  await containerNotificationService.sendContainerUpdateNotifications(
    allContainers,
    previousContainers,
    userId,
    batchLogger
  );

  return result;
}

/**
 * Get containers from Portainer without registry update checks
 * This allows viewing current containers and unused images without registry data
 * @returns {Promise<Object>} - Containers with basic information (no update status)
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Container retrieval requires comprehensive processing
async function getContainersFromPortainer(userId = null) {
  logger.debug("Fetching containers from Portainer");
  const allContainers = [];

  // Get source instances from database
  // If userId is null, get instances for all users
  let sourceInstances = [];
  if (userId) {
    sourceInstances = await getAllSourceInstances(userId);
  } else {
    const { getAllUsers } = require("../db/index");
    const users = await getAllUsers();
    for (const user of users) {
      const userInstances = await getAllSourceInstances(user.id);
      sourceInstances = sourceInstances.concat(userInstances);
    }
  }

  if (sourceInstances.length === 0) {
    logger.warn("No source instances configured.");
    return {
      grouped: true,
      stacks: [],
      containers: [],
      sourceInstances: [],
      unusedImagesCount: 0,
    };
  }

  // Fetch containers from all Portainer instances
  // OPTIMIZED: Also compute unused images count inline to avoid re-authenticating
  let totalUnusedImagesCount = 0;
  const allContainersForInstances = await Promise.all(
    sourceInstances.map(async (instance) => {
      const portainerUrl = instance.url;
      const instanceName = instance.name || new URL(portainerUrl).hostname;
      const { username } = instance;
      const { password } = instance;
      const apiKey = instance.api_key;
      const authType = instance.auth_type || "password";

      try {
        await portainerService.authenticatePortainer({
          portainerUrl,
          username,
          password,
          apiKey,
          authType,
        });
        const endpoints = await portainerService.getEndpoints(portainerUrl);

        if (endpoints.length === 0) {
          logger.warn(`No endpoints found for ${portainerUrl}`);
          return;
        }

        const endpointId = endpoints[0].Id;

        // Fetch containers and images in parallel (both already authenticated)
        const [containers, images] = await Promise.all([
          portainerService.getContainers(portainerUrl, endpointId),
          portainerService.getImages(portainerUrl, endpointId),
        ]);

        // Detect network mode relationships
        // OPTIMIZED: detectNetworkModes now reads HostConfig.NetworkMode directly
        // from the container list data — no per-container API calls needed

        const { containerNetworkModes } = await networkModeService.detectNetworkModes(
          containers,
          portainerUrl,
          endpointId
        );

        // Shared image details cache to deduplicate getImageDetails calls
        // Multiple containers often share the same image, so we cache by imageId
        const imageDetailsCache = new Map();

        const containersBasic = await Promise.all(
          containers.map(async (container) => {
            try {
              return containerProcessingService.processContainerBasic({
                container,
                portainerUrl,
                endpointId,
                instance,
                instanceName,
                containerNetworkModes,
                userId,
                imageDetailsCache,
              });
            } catch (error) {
              logger.error(`Error processing container ${container.Id}:`, { error });
              return null;
            }
          })
        );

        // Compute unused images count inline using already-fetched data
        // Use ImageID from container list (no per-container detail calls needed)
        const usedImageIds = new Set();
        const normalizeImageId = (id) => {
          const cleanId = id.replace(/^sha256:/, "");
          return cleanId.length >= 12 ? cleanId.substring(0, 12) : cleanId;
        };
        for (const container of containers) {
          if (container.ImageID) {
            usedImageIds.add(container.ImageID);
            usedImageIds.add(normalizeImageId(container.ImageID));
          }
        }
        let instanceUnusedCount = 0;
        for (const image of images) {
          const imageIdNormalized = normalizeImageId(image.Id);
          const isUsed = usedImageIds.has(image.Id) || usedImageIds.has(imageIdNormalized);
          if (!isUsed) {
            instanceUnusedCount++;
          }
        }
        totalUnusedImagesCount += instanceUnusedCount;

        // Filter out null results
        const validContainers = containersBasic.filter((c) => c !== null);

        if (validContainers.length > 0) {
          logger.debug(
            `Processed ${validContainers.length} containers from Portainer for instance ${instanceName}`,
            {
              instanceId: instance.id,
              portainerUrl,
            }
          );
        }

        return validContainers;
      } catch (error) {
        logger.error(`Error fetching containers from ${portainerUrl}:`, { error });
        // Fall back to DB-cached containers for this instance so they don't vanish
        if (userId && instance.id) {
          try {
            const dbContainers = require("../db/containers");
            const cachedContainers = await dbContainers.getContainersWithUpdates(
              userId,
              portainerUrl
            );
            if (cachedContainers && cachedContainers.length > 0) {
              const instanceMap = new Map([[instance.id, instance]]);
              const formatted = cachedContainers.map((c) => {
                const inst = instanceMap.get(c.sourceInstanceId);
                return containerFormattingService.formatContainerFromDatabase(c, inst);
              });
              logger.warn(
                `Falling back to ${formatted.length} DB-cached containers for ${instanceName}`,
                { module: "containerQueryService", portainerUrl }
              );
              return formatted;
            }
          } catch (fallbackErr) {
            logger.warn("DB fallback also failed for instance:", {
              portainerUrl,
              error: fallbackErr,
            });
          }
        }
        return [];
      }
    })
  );

  allContainersForInstances.forEach((instanceContainers) => {
    if (Array.isArray(instanceContainers) && instanceContainers.length > 0) {
      allContainers.push(...instanceContainers);
    }
  });

  // Group containers by stack
  const { stacks } = containerGroupingService.groupContainersByStackWithUnstacked(
    allContainers,
    "Unstacked"
  );

  // Unused images count was computed inline during the instance loop above
  const unusedImagesCount = totalUnusedImagesCount;

  // Group containers by source instance
  const sourceInstancesArray = containerGroupingService
    .groupContainersBySourceInstance(allContainers, sourceInstances)
    .map((instance) => ({
      ...instance,
      withUpdates: [], // No registry data
      upToDate: instance.containers, // All are "up to date" since we don't check
    }));

  const result = {
    grouped: true,
    stacks,
    containers: allContainers,
    sourceInstances: sourceInstancesArray,
    unusedImagesCount,
  };

  return result;
}

/**
 * Get unused images from all Portainer instances and runners
 * @returns {Promise<Array>} - Array of unused images
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Unused image detection requires comprehensive analysis
async function getUnusedImages(userId = null) {
  // Get source instances from database
  // If userId is null, get instances for all users
  let sourceInstances = [];
  if (userId) {
    sourceInstances = await getAllSourceInstances(userId);
  } else {
    const { getAllUsers } = require("../db/index");
    const users = await getAllUsers();
    for (const user of users) {
      const userInstances = await getAllSourceInstances(user.id);
      sourceInstances = sourceInstances.concat(userInstances);
    }
  }

  const unusedImagesPerInstance =
    sourceInstances.length > 0
      ? await Promise.all(
          sourceInstances.map(async (instance) => {
            const portainerUrl = instance.url;
            const { username } = instance;
            const { password } = instance;
            const apiKey = instance.api_key;
            const authType = instance.auth_type || "apikey";

            try {
              await portainerService.authenticatePortainer({
                portainerUrl,
                username,
                password,
                apiKey,
                authType,
              });
              const endpoints = await portainerService.getEndpoints(portainerUrl);
              if (endpoints.length === 0) {
                return [];
              }

              const endpointId = endpoints[0].Id;

              // Fetch images and containers in parallel (already authenticated)
              const [images, containers] = await Promise.all([
                portainerService.getImages(portainerUrl, endpointId),
                portainerService.getContainers(portainerUrl, endpointId),
              ]);

              // OPTIMIZED: Use ImageID from container list response instead of calling
              // getContainerDetails per container. The list API already includes ImageID.
              const usedIds = new Set();
              const normalizeImageId = (id) => {
                const cleanId = id.replace(/^sha256:/, "");
                return cleanId.length >= 12 ? cleanId.substring(0, 12) : cleanId;
              };

              for (const container of containers) {
                if (container.ImageID) {
                  usedIds.add(container.ImageID);
                  usedIds.add(normalizeImageId(container.ImageID));
                }
              }

              // Find unused images
              const collectedUnusedImages = [];
              // Images whose RepoTags are absent/invalid in the list response — need inspect.
              // The list API often omits tags (returns null / ["<none>:<none>"]) even when the
              // image has a real tag; inspect always returns the correct RepoTags.
              const needsInspection = [];

              for (const image of images) {
                const imageIdNormalized = normalizeImageId(image.Id);
                const isUsed = usedIds.has(image.Id) || usedIds.has(imageIdNormalized);

                if (!isUsed) {
                  const repoTags = image.RepoTags;
                  const hasValidRepoTags =
                    repoTags &&
                    repoTags.length > 0 &&
                    !(repoTags.length === 1 && repoTags[0] === "<none>:<none>");

                  if (!hasValidRepoTags) {
                    // Always inspect to get the real tags — RepoDigests will be the fallback
                    // inside the inspection handler if inspect also returns nothing useful.
                    needsInspection.push(image);
                    continue;
                  }

                  const instanceName = instance.name || new URL(portainerUrl).hostname;
                  collectedUnusedImages.push({
                    id: image.Id,
                    repoTags,
                    size: image.Size,
                    created: image.Created,
                    sourceUrl: portainerUrl,
                    endpointId,
                    sourceName: instanceName,
                  });
                }
              }

              // Batch-inspect all images that need tag lookups (all in parallel)
              if (needsInspection.length > 0) {
                const extractRepoTagsFromDigests = (digests) =>
                  digests.map((digest) => {
                    const repoPart = digest.split("@sha256:")[0];
                    return repoPart ? `${repoPart}:<none>` : "<none>:<none>";
                  });

                const inspectionResults = await Promise.all(
                  needsInspection.map(async (image) => {
                    try {
                      const imageDetails = await portainerService.getImageDetails(
                        portainerUrl,
                        endpointId,
                        image.Id
                      );
                      const hasValidDetailsTags =
                        imageDetails.RepoTags &&
                        imageDetails.RepoTags.length > 0 &&
                        !(
                          imageDetails.RepoTags.length === 1 &&
                          imageDetails.RepoTags[0] === "<none>:<none>"
                        );
                      const hasValidDetailsDigests =
                        imageDetails.RepoDigests && imageDetails.RepoDigests.length > 0;

                      let repoTags = null;
                      if (hasValidDetailsTags) {
                        repoTags = imageDetails.RepoTags;
                      } else if (hasValidDetailsDigests) {
                        repoTags = extractRepoTagsFromDigests(imageDetails.RepoDigests);
                      } else if (image.RepoDigests && image.RepoDigests.length > 0) {
                        repoTags = extractRepoTagsFromDigests(image.RepoDigests);
                      }
                      return { image, repoTags };
                    } catch (err) {
                      logger.debug(`Could not inspect image ${image.Id}: ${err.message}`);
                      const fallback =
                        image.RepoDigests && image.RepoDigests.length > 0
                          ? extractRepoTagsFromDigests(image.RepoDigests)
                          : null;
                      return { image, repoTags: fallback };
                    }
                  })
                );

                const instanceName = instance.name || new URL(portainerUrl).hostname;
                for (const { image, repoTags } of inspectionResults) {
                  collectedUnusedImages.push({
                    id: image.Id,
                    repoTags: repoTags || ["<none>:<none>"],
                    size: image.Size,
                    created: image.Created,
                    sourceUrl: portainerUrl,
                    endpointId,
                    sourceName: instanceName,
                  });
                }
              }
              return collectedUnusedImages;
            } catch (error) {
              logger.error(`Error fetching unused images from ${portainerUrl}:`, { error });
              return [];
            }
          })
        )
      : [];

  const result = unusedImagesPerInstance.flat();

  // Also fetch unused images from runner Docker hosts
  if (userId) {
    try {
      const runners = await getAllRunners(userId);
      const enabledRunners = runners.filter(
        (r) => r.enabled && r.docker_enabled && r.url && r.api_key
      );

      if (enabledRunners.length > 0) {
        const normalizeId = (id) => {
          const clean = (id || "").replace(/^sha256:/, "");
          return clean.length >= 12 ? clean.substring(0, 12) : clean;
        };

        const runnerUnused = await Promise.all(
          enabledRunners.map(async (runner) => {
            try {
              const [images, containers] = await Promise.all([
                runnerDockerService.getImages(runner.url, null, runner.api_key),
                runnerDockerService.getContainers(runner.url, null, runner.api_key),
              ]);

              const usedIds = new Set();
              for (const c of containers) {
                // Runner containers use camelCase imageId; normalisation adds both forms
                const imgId = c.ImageID || c.imageId;
                if (imgId) {
                  usedIds.add(imgId);
                  usedIds.add(normalizeId(imgId));
                }
              }

              const extractRunnerRepoTags = (digests) =>
                digests.map((d) => {
                  const repoPart = d.split("@sha256:")[0];
                  return repoPart ? `${repoPart}:<none>` : "<none>:<none>";
                });

              const unused = [];
              for (const img of images) {
                const imgId = img.id || img.Id;
                if (!imgId) continue;
                if (!usedIds.has(imgId) && !usedIds.has(normalizeId(imgId))) {
                  const repoTags = img.repoTags || img.RepoTags;
                  const repoDigests = img.repoDigests || img.RepoDigests;
                  const hasValidTags =
                    repoTags &&
                    repoTags.length > 0 &&
                    !(repoTags.length === 1 && repoTags[0] === "<none>:<none>");
                  const hasValidDigests = repoDigests && repoDigests.length > 0;
                  let resolvedTags;
                  if (hasValidTags) {
                    resolvedTags = repoTags;
                  } else if (hasValidDigests) {
                    resolvedTags = extractRunnerRepoTags(repoDigests);
                  } else {
                    resolvedTags = ["<none>:<none>"];
                  }
                  unused.push({
                    id: imgId,
                    repoTags: resolvedTags,
                    size: img.size || img.Size || 0,
                    created: img.created || img.Created || 0,
                    sourceUrl: runner.url,
                    endpointId: null,
                    sourceName: runner.name || runner.url,
                    runnerId: runner.id,
                  });
                }
              }
              return unused;
            } catch (err) {
              logger.error(
                `Error fetching unused images from runner ${runner.name || runner.url}:`,
                { error: err }
              );
              return [];
            }
          })
        );

        result.push(...runnerUnused.flat());
      }
    } catch (err) {
      logger.error("Error fetching runner unused images:", { error: err });
    }
  }

  return result;
}

module.exports = {
  getAllContainersWithUpdates,
  getContainersFromPortainer,
  getUnusedImages,
};

/**
 * Container Query Service
 * Handles container querying and retrieval operations
 */

const { URL } = require("url");
const portainerService = require("./portainerService");
const dockerRegistryService = require("./dockerRegistryService");
const networkModeService = require("./networkModeService");
const containerGroupingService = require("./containerGroupingService");
const containerFormattingService = require("./containerFormattingService");
const containerNotificationService = require("./containerNotificationService");
const containerProcessingService = require("./containerProcessingService");
const containerDataService = require("./containerDataService");
const containerQueryOrchestrationService = require("./containerQueryOrchestrationService");
const { getAllPortainerInstances, getAllTrackedApps } = require("../db/index");
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
  filterPortainerUrl = null,
  userId = null,
  batchLogger = null
) {
  // Get previous data from normalized tables to compare for newly detected updates
  let previousContainers = null;
  if (forceRefresh && userId) {
    const { getPortainerContainersWithUpdates } = require("../db/index");
    previousContainers = await getPortainerContainersWithUpdates(userId);
    // Clear registry digest cache to ensure fresh data when force refreshing
    // This prevents stale cached digests from causing false positives when containers
    // were updated outside the app (e.g., manually via Portainer or docker pull)
    dockerRegistryService.clearAllDigestCache();
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
      const { getPortainerContainersWithUpdates } = require("../db/index");
      const normalizedContainers = await getPortainerContainersWithUpdates(userId);

      if (normalizedContainers && normalizedContainers.length > 0) {
        // We have data in normalized tables - format it for the frontend
        const userInstances = await getAllPortainerInstances(userId);

        // Create instance map for quick lookup
        const instanceMap = new Map(userInstances.map((inst) => [inst.id, inst]));

        // Format containers to match expected structure
        const formattedContainers = normalizedContainers.map((c) => {
          const instance = instanceMap.get(c.portainerInstanceId);
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

        // Build portainerInstances array
        const portainerInstancesArray = containerDataService.buildPortainerInstancesArray(
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
          portainerInstances: portainerInstancesArray,
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
      portainerInstances: [],
      unusedImagesCount: 0,
    };
  }
  // Only when forceRefresh=true (explicit pull request or batch process)
  if (filterPortainerUrl) {
    logger.info(
      `Force refresh requested for instance ${filterPortainerUrl}, fetching fresh data from registries...`
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
      filterPortainerUrl
    );

  if (instancesToProcess.length === 0) {
    // Only log warning, not every time
    if (process.env.DEBUG) {
      logger.debug("No Portainer instances to process.");
    }
    // Return empty result
    return {
      grouped: true,
      stacks: [],
      containers: [],
      portainerInstances: [],
      unusedImagesCount: 0,
    };
  }

  // Get portainerInstances for result building (unfiltered)
  const portainerInstances =
    await containerQueryOrchestrationService.getPortainerInstancesToProcess(userId, null);

  // If filtering by specific instance, get existing data from normalized tables to merge with
  let existingContainers = null;
  if (filterPortainerUrl && previousContainers) {
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
      if (userId && instance.id && currentContainerIds.size > 0) {
        try {
          const { deletePortainerContainersNotInList } = require("../db/index");
          const deletedCount = await deletePortainerContainersNotInList(
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
  if (filterPortainerUrl && existingContainers) {
    // Merge container data
    allContainers = await containerDataService.mergeContainerData(
      allContainers,
      existingContainers,
      userId,
      filterPortainerUrl,
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
    for (const instance of portainerInstances) {
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
          continue;
        }

        const endpointId = endpoints[0].Id;
        const count = await containerDataService.countUnusedImages(portainerUrl, endpointId);
        unusedImagesCount += count;
      } catch (error) {
        logger.error(`Error counting unused images from ${portainerUrl}:`, { error });
      }
    }
  }

  // Build portainerInstances array for frontend
  const portainerInstancesArray = containerDataService.buildPortainerInstancesArray(
    allContainers,
    portainerInstances
  );

  const result = {
    grouped: true,
    stacks: groupedContainers,
    containers: allContainers,
    portainerInstances: portainerInstancesArray,
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
  logger.info("Fetching containers from Portainer");
  const allContainers = [];

  // Get Portainer instances from database
  // If userId is null, get instances for all users
  let portainerInstances = [];
  if (userId) {
    portainerInstances = await getAllPortainerInstances(userId);
  } else {
    const { getAllUsers } = require("../db/index");
    const users = await getAllUsers();
    for (const user of users) {
      const userInstances = await getAllPortainerInstances(user.id);
      portainerInstances = portainerInstances.concat(userInstances);
    }
  }

  if (portainerInstances.length === 0) {
    logger.warn("No Portainer instances configured.");
    return {
      grouped: true,
      stacks: [],
      containers: [],
      portainerInstances: [],
      unusedImagesCount: 0,
    };
  }

  // Fetch containers from all Portainer instances
  for (const instance of portainerInstances) {
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
        continue;
      }

      const endpointId = endpoints[0].Id;
      const containers = await portainerService.getContainers(portainerUrl, endpointId);

      // Detect network mode relationships

      const { containerNetworkModes } = await networkModeService.detectNetworkModes(
        containers,
        portainerUrl,
        endpointId
      );

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
            });
          } catch (error) {
            logger.error(`Error processing container ${container.Id}:`, { error });
            return null;
          }
        })
      );

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

      allContainers.push(...validContainers);
    } catch (error) {
      logger.error(`Error fetching containers from ${portainerUrl}:`, { error });
    }
  }

  // Group containers by stack
  const { stacks } = containerGroupingService.groupContainersByStackWithUnstacked(
    allContainers,
    "Unstacked"
  );

  // Get unused images count
  const unusedImages = await getUnusedImages();
  const unusedImagesCount = unusedImages.length;

  // Group containers by Portainer instance
  const portainerInstancesArray = containerGroupingService
    .groupContainersByPortainerInstance(allContainers, portainerInstances)
    .map((instance) => ({
      ...instance,
      withUpdates: [], // No registry data
      upToDate: instance.containers, // All are "up to date" since we don't check
    }));

  const result = {
    grouped: true,
    stacks,
    containers: allContainers,
    portainerInstances: portainerInstancesArray,
    unusedImagesCount,
  };

  return result;
}

/**
 * Get unused images from all Portainer instances
 * @returns {Promise<Array>} - Array of unused images
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Unused image detection requires comprehensive analysis
async function getUnusedImages(userId = null) {
  const unusedImages = [];

  // Get Portainer instances from database
  // If userId is null, get instances for all users
  let portainerInstances = [];
  if (userId) {
    portainerInstances = await getAllPortainerInstances(userId);
  } else {
    const { getAllUsers } = require("../db/index");
    const users = await getAllUsers();
    for (const user of users) {
      const userInstances = await getAllPortainerInstances(user.id);
      portainerInstances = portainerInstances.concat(userInstances);
    }
  }

  if (portainerInstances.length === 0) {
    return [];
  }

  for (const instance of portainerInstances) {
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
        continue;
      }

      const endpointId = endpoints[0].Id;
      const images = await portainerService.getImages(portainerUrl, endpointId);
      const containers = await portainerService.getContainers(portainerUrl, endpointId);

      // Get all used image IDs
      const usedIds = new Set();
      const normalizeImageId = (id) => {
        const cleanId = id.replace(/^sha256:/, "");
        return cleanId.length >= 12 ? cleanId.substring(0, 12) : cleanId;
      };

      for (const container of containers) {
        const details = await portainerService.getContainerDetails(
          portainerUrl,
          endpointId,
          container.Id
        );
        if (details.Image) {
          usedIds.add(details.Image);
          usedIds.add(normalizeImageId(details.Image));
        }
      }

      // Find unused images
      for (const image of images) {
        const imageIdNormalized = normalizeImageId(image.Id);
        const isUsed = usedIds.has(image.Id) || usedIds.has(imageIdNormalized);

        if (!isUsed) {
          let repoTags = image.RepoTags;

          // If RepoTags is null or empty, try to get from RepoDigests
          const hasValidRepoTags =
            repoTags &&
            repoTags.length > 0 &&
            !(repoTags.length === 1 && repoTags[0] === "<none>:<none>");

          if (!hasValidRepoTags) {
            const extractRepoTagsFromDigests = (digests) =>
              digests.map((digest) => {
                const repoPart = digest.split("@sha256:")[0];
                return repoPart ? `${repoPart}:<none>` : "<none>:<none>";
              });

            const hasRepoDigests = image.RepoDigests && image.RepoDigests.length > 0;
            if (hasRepoDigests) {
              repoTags = extractRepoTagsFromDigests(image.RepoDigests);
            } else {
              // Try to inspect the image to get more details
              const inspectImageForRepoTags = async () => {
                try {
                  const imageDetails = await portainerService.getImageDetails(
                    portainerUrl,
                    endpointId,
                    image.Id
                  );
                  const hasValidDetailsTags =
                    imageDetails.RepoTags && imageDetails.RepoTags.length > 0;
                  const hasValidDetailsDigests =
                    imageDetails.RepoDigests && imageDetails.RepoDigests.length > 0;

                  if (hasValidDetailsTags) {
                    return imageDetails.RepoTags;
                  } else if (hasValidDetailsDigests) {
                    return extractRepoTagsFromDigests(imageDetails.RepoDigests);
                  }
                  return null;
                } catch (err) {
                  logger.debug(`Could not inspect image ${image.Id}: ${err.message}`);
                  return null;
                }
              };

              const inspectedRepoTags = await inspectImageForRepoTags();
              if (inspectedRepoTags) {
                repoTags = inspectedRepoTags;
              }
            }
          }

          // Fallback to default if still no tags
          if (!repoTags || repoTags.length === 0) {
            repoTags = ["<none>:<none>"];
          }

          const instanceName = instance.name || new URL(portainerUrl).hostname;
          unusedImages.push({
            id: image.Id,
            repoTags,
            size: image.Size,
            created: image.Created,
            portainerUrl,
            endpointId,
            portainerName: instanceName,
          });
        }
      }
    } catch (error) {
      logger.error(`Error fetching unused images from ${portainerUrl}:`, { error });
    }
  }

  return unusedImages;
}

module.exports = {
  getAllContainersWithUpdates,
  getContainersFromPortainer,
  getUnusedImages,
};

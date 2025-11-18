/**
 * Container Query Service
 * Handles container querying and retrieval operations
 */

const { URL } = require("url");
const portainerService = require("./portainerService");
const dockerRegistryService = require("./dockerRegistryService");
const networkModeService = require("./networkModeService");
const imageUpdateService = require("./imageUpdateService");
const {
  getAllPortainerInstances,
  getContainerCache,
  setContainerCache,
} = require("../db/database");
const logger = require("../utils/logger");

// Lazy load discordService to avoid loading issues during module initialization
let discordService = null;
function getDiscordService() {
  if (!discordService) {
    try {
      discordService = require("./discordService");
    } catch (error) {
      logger.error("Error loading discordService:", error);
      return null;
    }
  }
  return discordService;
}

/**
 * Get all containers with update status from all Portainer instances
 * @returns {Promise<Object>} - Containers grouped by stack
 */
/**
 * Get all containers with update status
 * @param {boolean} forceRefresh - If true, bypass cache and fetch fresh data
 * @returns {Promise<Object>} - Containers with update information
 */
async function getAllContainersWithUpdates(forceRefresh = false, filterPortainerUrl = null, userId = null) {
  // Get previous cache to compare for newly detected updates
  let previousCache = null;
  if (forceRefresh) {
    previousCache = await getContainerCache("containers");
    // Clear Docker Hub digest cache to ensure fresh data when force refreshing
    // This prevents stale cached digests from causing false positives when containers
    // were updated outside the app (e.g., manually via Portainer or docker pull)
    dockerRegistryService.clearAllDigestCache();
  }

  // Check cache first unless force refresh is requested
  if (!forceRefresh) {
    const cached = await getContainerCache("containers");
    if (cached) {
      // Reduced logging - only log in debug mode
      if (process.env.DEBUG) {
        logger.debug("Using cached container data from database");
      }
      // Filter cached data by user's portainer instances if userId provided
      if (userId && cached.portainerInstances) {
        const userInstances = await getAllPortainerInstances(userId);
        const userInstanceUrls = new Set(userInstances.map(inst => inst.url));
        const filteredContainers = cached.containers?.filter(c => userInstanceUrls.has(c.portainerUrl)) || [];
        const filteredInstances = cached.portainerInstances.filter(inst => userInstanceUrls.has(inst.url));
        const filteredStacks = cached.stacks?.map(stack => ({
          ...stack,
          containers: stack.containers?.filter(c => userInstanceUrls.has(c.portainerUrl)) || []
        })).filter(stack => stack.containers && stack.containers.length > 0) || [];
        return {
          ...cached,
          containers: filteredContainers,
          portainerInstances: filteredInstances,
          stacks: filteredStacks,
        };
      }
      return cached;
    }
    // No cached data found - return empty result instead of fetching from Docker Hub
    // User must explicitly click "Pull" or batch process must run to fetch fresh data
    if (process.env.DEBUG) {
      logger.debug(
        'No cached data found, returning empty result. User must click "Pull" to fetch data.'
      );
    }
    // IMPORTANT: Do NOT call Docker Hub here - only return empty result
    return {
      grouped: true,
      stacks: [],
      containers: [],
      portainerInstances: [],
      unusedImagesCount: 0,
    };
  } else {
    // Only when forceRefresh=true (explicit pull request or batch process)
    if (filterPortainerUrl) {
      logger.info(
        `Force refresh requested for instance ${filterPortainerUrl}, fetching fresh data from Docker Hub...`
      );
    } else {
      logger.info("Force refresh requested, fetching fresh data from Docker Hub...");
    }
    // Don't clear cache immediately - keep old data visible until new data is ready
    // Cache will be replaced when new data is saved
  }
  const allContainers = [];

  // Get Portainer instances from database
  // If userId is null (batch job), get instances for all users
  let portainerInstances = [];
  if (userId) {
    portainerInstances = await getAllPortainerInstances(userId);
  } else {
    // For batch jobs, get all users and their instances
    const { getAllUsers } = require("../db/database");
    const users = await getAllUsers();
    for (const user of users) {
      const userInstances = await getAllPortainerInstances(user.id);
      portainerInstances = portainerInstances.concat(userInstances);
    }
  }

  // Filter to specific instance if requested
  const instancesToProcess = filterPortainerUrl
    ? portainerInstances.filter((inst) => inst.url === filterPortainerUrl)
    : portainerInstances;

  if (instancesToProcess.length === 0) {
    // Only log warning, not every time
    if (process.env.DEBUG) {
      logger.debug("No Portainer instances to process.");
    }
    // Return empty result and cache it so we don't keep trying to fetch
    const emptyResult = {
      grouped: true,
      stacks: [],
      containers: [],
      portainerInstances: [],
      unusedImagesCount: 0,
    };
    // Cache empty result to prevent repeated attempts
    try {
      await setContainerCache("containers", emptyResult);
    } catch (error) {
      logger.error("Error caching empty result:", error.message);
    }
    return emptyResult;
  }

  // If filtering by specific instance, get existing cache to merge with
  let existingCache = null;
  if (filterPortainerUrl && previousCache) {
    existingCache = previousCache;
  }

  // Fetch containers from Portainer instances (filtered if specified)
  for (const instance of instancesToProcess) {
    const portainerUrl = instance.url || instance;
    const instanceName =
      instance.name ||
      (typeof instance === "string" ? new URL(instance).hostname : new URL(portainerUrl).hostname);
    const username = instance.username;
    const password = instance.password;

    try {
      await portainerService.authenticatePortainer(portainerUrl, username, password);
      const endpoints = await portainerService.getEndpoints(portainerUrl);

      if (endpoints.length === 0) {
        logger.warn(`No endpoints found for ${portainerUrl}`);
        continue;
      }

      // Use first endpoint for each Portainer instance
      const endpointId = endpoints[0].Id;
      const containers = await portainerService.getContainers(portainerUrl, endpointId);

      // Detect network mode relationships
      const { containerNetworkModes, containerByIdentifier } =
        await networkModeService.detectNetworkModes(containers, portainerUrl, endpointId);

      const containersWithUpdates = await Promise.all(
        containers.map(async (container) => {
          try {
            const details = await portainerService.getContainerDetails(
              portainerUrl,
              endpointId,
              container.Id
            );
            const imageName = details.Config.Image;

            // Reduced logging - only log in debug mode or for errors
            const updateInfo = await imageUpdateService.checkImageUpdates(
              imageName,
              details,
              portainerUrl,
              endpointId
            );

            // Extract stack name from labels
            const labels = details.Config.Labels || {};
            const stackName =
              labels["com.docker.compose.project"] || labels["com.docker.stack.namespace"] || null;

            // Check if container uses network_mode (service:* or container:*)
            const usesNetworkMode = networkModeService.containerUsesNetworkMode(details);

            // Check if container provides network (other containers depend on it via network_mode)
            const providesNetwork = networkModeService.containerProvidesNetwork(
              container,
              containerNetworkModes
            );

            // Get image creation date by inspecting the image
            let currentImageCreated = null;
            const imageId = details.Image || "";
            if (imageId) {
              try {
                const imageDetails = await portainerService.getImageDetails(
                  portainerUrl,
                  endpointId,
                  imageId
                );
                if (imageDetails.Created) {
                  currentImageCreated = imageDetails.Created;
                }
              } catch (imageError) {
                // If we can't get image details, just continue without created date
                logger.debug(`Could not get image details for ${imageId}: ${imageError.message}`);
              }
            }

            return {
              id: container.Id,
              name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
              image: imageName,
              status: container.Status,
              state: container.State,
              endpointId: endpointId,
              portainerUrl: portainerUrl,
              portainerName: instanceName,
              hasUpdate: updateInfo.hasUpdate,
              currentTag: updateInfo.currentTag,
              currentVersion: updateInfo.currentVersion,
              currentDigest: updateInfo.currentDigest,
              latestTag: updateInfo.latestTag,
              newVersion: updateInfo.newVersion,
              latestDigest: updateInfo.latestDigest,
              currentDigestFull: updateInfo.currentDigestFull,
              latestDigestFull: updateInfo.latestDigestFull,
              latestPublishDate: updateInfo.latestPublishDate,
              currentVersionPublishDate: updateInfo.currentVersionPublishDate,
              currentImageCreated: currentImageCreated,
              imageRepo: updateInfo.imageRepo,
              stackName: stackName,
              existsInDockerHub: updateInfo.existsInDockerHub || false,
              usesNetworkMode: usesNetworkMode || false,
              providesNetwork: providesNetwork || false,
            };
          } catch (error) {
            // If rate limit exceeded, propagate the error to stop the entire process
            if (error.isRateLimitExceeded) {
              throw error;
            }
            // If a single container fails, log it but don't break the entire process
            if (process.env.DEBUG) {
              logger.error(
                `Error checking updates for container ${container.Names[0]?.replace("/", "") || container.Id.substring(0, 12)}:`,
                error.message
              );
            }
            // Return a basic container object without update info
            // Try to check if image exists in Docker Hub even if update check failed
            let existsInDockerHub = false;
            try {
              const imageName = container.Image || "unknown";
              const imageParts = imageName.includes(":")
                ? imageName.split(":")
                : [imageName, "latest"];
              const repo = imageParts[0];
              existsInDockerHub = await dockerRegistryService.checkImageExistsInDockerHub(repo);
            } catch (error) {
              // Silently continue - assume false if check fails
              existsInDockerHub = false;
            }

            return {
              id: container.Id,
              name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
              image: container.Image || "unknown",
              status: container.Status,
              state: container.State,
              endpointId: endpointId,
              portainerUrl: portainerUrl,
              portainerName: instanceName,
              hasUpdate: false,
              currentTag: null,
              currentVersion: null,
              currentDigest: null,
              latestTag: null,
              newVersion: null,
              latestDigest: null,
              currentDigestFull: null,
              latestDigestFull: null,
              latestPublishDate: null,
              imageRepo: null,
              stackName: null,
              existsInDockerHub: existsInDockerHub,
            };
          }
        })
      );

      allContainers.push(...containersWithUpdates);
    } catch (error) {
      // If rate limit exceeded, propagate the error immediately
      if (error.isRateLimitExceeded) {
        throw error;
      }
      logger.error(`Error fetching containers from ${portainerUrl}:`, error.message);
      // Continue with other Portainer instances even if one fails
    }
  }

  // Group containers by stack
  const groupedByStack = allContainers.reduce((acc, container) => {
    const stackName = container.stackName || "Standalone";
    if (!acc[stackName]) {
      acc[stackName] = [];
    }
    acc[stackName].push(container);
    return acc;
  }, {});

  // Convert to array format with stack names
  const groupedContainers = Object.keys(groupedByStack).map((stackName) => ({
    stackName: stackName,
    containers: groupedByStack[stackName],
  }));

  // Sort stacks: named stacks first, then "Standalone"
  groupedContainers.sort((a, b) => {
    if (a.stackName === "Standalone") {
      return 1;
    }
    if (b.stackName === "Standalone") {
      return -1;
    }
    return a.stackName.localeCompare(b.stackName);
  });

  // Declare unusedImagesCount variable
  let unusedImagesCount = 0;

  // If filtering by specific instance, merge with existing cache
  if (filterPortainerUrl && existingCache) {
    // Remove containers from the filtered instance from existing cache
    const otherContainers = existingCache.containers.filter(
      (c) => c.portainerUrl !== filterPortainerUrl
    );
    // Combine with new containers from the filtered instance
    allContainers.push(...otherContainers);

    // Re-group containers by stack
    const mergedGroupedByStack = allContainers.reduce((acc, container) => {
      const stackName = container.stackName || "Standalone";
      if (!acc[stackName]) {
        acc[stackName] = [];
      }
      acc[stackName].push(container);
      return acc;
    }, {});

    // Convert to array format with stack names
    const mergedGroupedContainers = Object.keys(mergedGroupedByStack).map((stackName) => ({
      stackName: stackName,
      containers: mergedGroupedByStack[stackName],
    }));

    // Sort stacks: named stacks first, then "Standalone"
    mergedGroupedContainers.sort((a, b) => {
      if (a.stackName === "Standalone") {
        return 1;
      }
      if (b.stackName === "Standalone") {
        return -1;
      }
      return a.stackName.localeCompare(b.stackName);
    });

    // Update groupedContainers with merged data
    groupedContainers.length = 0;
    groupedContainers.push(...mergedGroupedContainers);

    // Use existing unused images count (or recalculate if needed)
    unusedImagesCount = existingCache.unusedImagesCount || 0;
  } else {
    // Get unused images count for all instances
    for (const instance of portainerInstances) {
      const portainerUrl = instance.url || instance;
      const username = instance.username;
      const password = instance.password;
      const apiKey = instance.api_key;
      const authType = instance.auth_type || "apikey";

      try {
        await portainerService.authenticatePortainer(
          portainerUrl,
          username,
          password,
          apiKey,
          authType
        );
        const endpoints = await portainerService.getEndpoints(portainerUrl);
        if (endpoints.length === 0) {
          continue;
        }

        const endpointId = endpoints[0].Id;
        const images = await portainerService.getImages(portainerUrl, endpointId);
        const containers = await portainerService.getContainers(portainerUrl, endpointId);

        // Get all used image IDs (normalize to handle both full and shortened IDs)
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

        // Count unused images
        for (const image of images) {
          const imageIdNormalized = normalizeImageId(image.Id);
          const isUsed = usedIds.has(image.Id) || usedIds.has(imageIdNormalized);
          if (!isUsed) {
            unusedImagesCount++;
          }
        }
      } catch (error) {
        logger.error(`Error counting unused images from ${portainerUrl}:`, error.message);
      }
    }
  }

  // Build portainerInstances array for frontend
  const portainerInstancesArray = portainerInstances.map((instance) => {
    const portainerUrl = instance.url || instance;
    const instanceName =
      instance.name ||
      (typeof instance === "string" ? new URL(instance).hostname : new URL(portainerUrl).hostname);

    // Get containers for this instance
    const instanceContainers = allContainers.filter((c) => c.portainerUrl === portainerUrl);
    const withUpdates = instanceContainers.filter((c) => c.hasUpdate);
    const upToDate = instanceContainers.filter((c) => !c.hasUpdate);

    return {
      id: instance.id,
      name: instanceName,
      url: portainerUrl,
      containers: instanceContainers,
      withUpdates: withUpdates,
      upToDate: upToDate,
      totalContainers: instanceContainers.length,
    };
  });

  const result = {
    grouped: true,
    stacks: groupedContainers,
    containers: allContainers,
    portainerInstances: portainerInstancesArray,
    unusedImagesCount: unusedImagesCount,
  };

  // Save to cache for future requests
  // This replaces the old cache with fresh data (or merges if filtering by instance)
  // When forceRefresh=true, this includes both Portainer and Docker Hub data
  try {
    // Check if result has Docker Hub data (containers with latestDigest or latestTag)
    const hasDockerHubData = result.containers && result.containers.some(
      (c) => c.latestDigest || c.latestTag || c.hasUpdate !== undefined
    );
    
    const metadata = {
      lastPortainerPull: new Date().toISOString(),
    };
    
    // Only set Docker Hub pull timestamp if we actually have Docker Hub data
    if (hasDockerHubData) {
      metadata.lastDockerHubPull = new Date().toISOString();
    }
    
    await setContainerCache("containers", result, metadata);
    if (filterPortainerUrl) {
      logger.info(
        `Container data cached in database (merged data for instance ${filterPortainerUrl})`
      );
    } else {
      logger.info("Container data cached in database (replaced old cache)");
    }
  } catch (error) {
    logger.error("Error saving container cache:", error.message);
    // Continue even if cache save fails
  }

  // Send Discord notifications for newly detected container updates
  if (previousCache && previousCache.containers) {
    try {
      const discord = getDiscordService();
      if (discord && discord.queueNotification) {
        // Create a map of previous containers by unique identifier
        // Use combination of name, portainerUrl, and endpointId for uniqueness
        // (Name is more stable than ID, which changes after upgrades)
        const previousContainersMap = new Map();
        previousCache.containers.forEach((container) => {
          // Use name as primary key since container IDs change after upgrades
          const key = `${container.name}-${container.portainerUrl}-${container.endpointId}`;
          previousContainersMap.set(key, container);
        });

        // Check each new container for newly detected updates
        for (const container of allContainers) {
          if (container.hasUpdate) {
            // Match by name (more stable than ID which changes after upgrades)
            const key = `${container.name}-${container.portainerUrl}-${container.endpointId}`;
            const previousContainer = previousContainersMap.get(key);

            // Only notify if this is a newly detected update (didn't have update before)
            // Match by name instead of ID since container IDs change after upgrades.
            // This is the key fix: by matching by name, we can track the same container across upgrades,
            // preventing false notifications when the container ID changes but name stays the same.
            //
            // Key fix: If previous container (matched by name) had hasUpdate: false, we skip notification
            // even if new one shows hasUpdate: true. This prevents false notifications after upgrades
            // when the cache shows hasUpdate: false but a fresh fetch shows hasUpdate: true again.
            //
            // We notify if:
            // 1. No previous container exists (truly new container)
            //
            // We do NOT notify if:
            // - Previous container had hasUpdate: false (was up-to-date or just upgraded - prevents false notifications)
            // - Previous container had hasUpdate: true (already had update - don't notify again)
            //
            // Note: This means we won't notify for containers that were truly up-to-date and now have a new update,
            // but that's acceptable to prevent false notifications after upgrades.
            const shouldNotify = !previousContainer;

            if (shouldNotify) {
              // Format container data for notification
              const imageName = container.image || "Unknown";
              const currentVersion = container.currentVersion || container.currentTag || "Unknown";
              const latestVersion =
                container.newVersion || container.latestTag || container.latestVersion || "Unknown";

              await discord.queueNotification({
                id: container.id,
                name: container.name,
                imageName: imageName,
                githubRepo: null,
                sourceType: "docker",
                currentVersion: currentVersion,
                latestVersion: latestVersion,
                latestVersionPublishDate: container.latestPublishDate || null,
                releaseUrl: null, // Containers don't have release URLs
                notificationType: "portainer-container",
              });
            }
          }
        }
      }
    } catch (error) {
      // Don't fail the update check if notification fails
      logger.error("Error sending Discord notifications for container updates:", error);
    }
  }

  return result;
}

/**
 * Get containers from Portainer without Docker Hub update checks
 * This allows viewing current containers and unused images without Docker Hub data
 * @returns {Promise<Object>} - Containers with basic information (no update status)
 */
async function getContainersFromPortainer(userId = null) {
  logger.info("Fetching containers from Portainer");
  const allContainers = [];

  // Get Portainer instances from database
  // If userId is null, get instances for all users
  let portainerInstances = [];
  if (userId) {
    portainerInstances = await getAllPortainerInstances(userId);
  } else {
    const { getAllUsers } = require("../db/database");
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
    const username = instance.username;
    const password = instance.password;
    const apiKey = instance.api_key;
    const authType = instance.auth_type || "password";

    try {
      await portainerService.authenticatePortainer(
        portainerUrl,
        username,
        password,
        apiKey,
        authType
      );
      const endpoints = await portainerService.getEndpoints(portainerUrl);

      if (endpoints.length === 0) {
        logger.warn(`No endpoints found for ${portainerUrl}`);
        continue;
      }

      const endpointId = endpoints[0].Id;
      const containers = await portainerService.getContainers(portainerUrl, endpointId);

      // Detect network mode relationships
      const { containerNetworkModes, containerByIdentifier } =
        await networkModeService.detectNetworkModes(containers, portainerUrl, endpointId);

      const containersBasic = await Promise.all(
        containers.map(async (container) => {
          try {
            const details = await portainerService.getContainerDetails(
              portainerUrl,
              endpointId,
              container.Id
            );
            const imageName = details.Config.Image;

            // Extract image digest from Image field (format: sha256:...)
            const imageId = details.Image || "";
            const currentDigest = imageId.startsWith("sha256:")
              ? imageId.split(":")[1].substring(0, 12)
              : imageId.substring(0, 12);

            // Extract tag from image name
            const imageParts = imageName.includes(":")
              ? imageName.split(":")
              : [imageName, "latest"];
            const currentTag = imageParts[1];

            // Extract stack name from labels
            const labels = details.Config.Labels || {};
            const stackName =
              labels["com.docker.compose.project"] || labels["com.docker.stack.namespace"] || null;

            // Check if container uses network_mode (service:* or container:*)
            const usesNetworkMode = networkModeService.containerUsesNetworkMode(details);

            // Check if container provides network (other containers depend on it via network_mode)
            const providesNetwork = networkModeService.containerProvidesNetwork(
              container,
              containerNetworkModes
            );

            // Get image creation date by inspecting the image
            let currentImageCreated = null;
            if (imageId) {
              try {
                const imageDetails = await portainerService.getImageDetails(
                  portainerUrl,
                  endpointId,
                  imageId
                );
                if (imageDetails.Created) {
                  currentImageCreated = imageDetails.Created;
                }
              } catch (imageError) {
                // If we can't get image details, just continue without created date
                logger.debug(`Could not get image details for ${imageId}: ${imageError.message}`);
              }
            }

            // In portainerOnly mode, we don't check Docker Hub, so existsInDockerHub is unknown
            // It will be determined when Docker Hub data is pulled
            const existsInDockerHub = false;

            return {
              id: container.Id,
              name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
              image: imageName,
              status: container.Status,
              state: container.State,
              endpointId: endpointId,
              portainerUrl: portainerUrl,
              portainerName: instanceName,
              hasUpdate: false, // No Docker Hub check
              currentDigest: currentDigest,
              currentTag: currentTag,
              currentVersion: currentTag,
              latestDigest: null,
              latestTag: null,
              latestVersion: null,
              currentVersionPublishDate: null,
              currentImageCreated: currentImageCreated,
              stackName: stackName,
              imageId: details.Image,
              existsInDockerHub: existsInDockerHub,
              usesNetworkMode: usesNetworkMode || false,
              providesNetwork: providesNetwork || false,
            };
          } catch (error) {
            logger.error(`Error processing container ${container.Id}:`, error.message);
            return null;
          }
        })
      );

      // Filter out null results
      const validContainers = containersBasic.filter((c) => c !== null);
      allContainers.push(...validContainers);
    } catch (error) {
      logger.error(`Error fetching containers from ${portainerUrl}:`, error.message);
    }
  }

  // Group containers by stack
  const stacksMap = new Map();
  const unstackedContainers = [];

  for (const container of allContainers) {
    if (container.stackName) {
      if (!stacksMap.has(container.stackName)) {
        stacksMap.set(container.stackName, []);
      }
      stacksMap.get(container.stackName).push(container);
    } else {
      unstackedContainers.push(container);
    }
  }

  const stacks = Array.from(stacksMap.entries()).map(([name, containers]) => ({
    name,
    containers,
  }));

  if (unstackedContainers.length > 0) {
    stacks.push({
      name: "Unstacked",
      containers: unstackedContainers,
    });
  }

  // Get unused images count
  const unusedImages = await getUnusedImages();
  const unusedImagesCount = unusedImages.length;

  // Group containers by Portainer instance
  const portainerInstancesArray = portainerInstances.map((instance) => {
    const instanceContainers = allContainers.filter((c) => c.portainerUrl === instance.url);
    return {
      name: instance.name || new URL(instance.url).hostname,
      url: instance.url,
      id: instance.id,
      containers: instanceContainers,
      withUpdates: [], // No Docker Hub data
      upToDate: instanceContainers, // All are "up to date" since we don't check
    };
  });

  const result = {
    grouped: true,
    stacks: stacks,
    containers: allContainers,
    portainerInstances: portainerInstancesArray,
    unusedImagesCount: unusedImagesCount,
  };

  return result;
}

/**
 * Get unused images from all Portainer instances
 * @returns {Promise<Array>} - Array of unused images
 */
async function getUnusedImages(userId = null) {
  const unusedImages = [];

  // Get Portainer instances from database
  // If userId is null, get instances for all users
  let portainerInstances = [];
  if (userId) {
    portainerInstances = await getAllPortainerInstances(userId);
  } else {
    const { getAllUsers } = require("../db/database");
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
    const username = instance.username;
    const password = instance.password;
    const apiKey = instance.api_key;
    const authType = instance.auth_type || "apikey";

    try {
      await portainerService.authenticatePortainer(
        portainerUrl,
        username,
        password,
        apiKey,
        authType
      );
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
          if (
            !repoTags ||
            repoTags.length === 0 ||
            (repoTags.length === 1 && repoTags[0] === "<none>:<none>")
          ) {
            if (image.RepoDigests && image.RepoDigests.length > 0) {
              repoTags = image.RepoDigests.map((digest) => {
                const repoPart = digest.split("@sha256:")[0];
                return repoPart ? `${repoPart}:<none>` : "<none>:<none>";
              });
            } else {
              // Try to inspect the image to get more details
              try {
                const imageDetails = await portainerService.getImageDetails(
                  portainerUrl,
                  endpointId,
                  image.Id
                );
                if (imageDetails.RepoTags && imageDetails.RepoTags.length > 0) {
                  repoTags = imageDetails.RepoTags;
                } else if (imageDetails.RepoDigests && imageDetails.RepoDigests.length > 0) {
                  repoTags = imageDetails.RepoDigests.map((digest) => {
                    const repoPart = digest.split("@sha256:")[0];
                    return repoPart ? `${repoPart}:<none>` : "<none>:<none>";
                  });
                }
              } catch (err) {
                logger.debug(`Could not inspect image ${image.Id}: ${err.message}`);
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
            repoTags: repoTags,
            size: image.Size,
            created: image.Created,
            portainerUrl: portainerUrl,
            endpointId: endpointId,
            portainerName: instanceName,
          });
        }
      }
    } catch (error) {
      logger.error(`Error fetching unused images from ${portainerUrl}:`, error.message);
    }
  }

  return unusedImages;
}

module.exports = {
  getAllContainersWithUpdates,
  getContainersFromPortainer,
  getUnusedImages,
};

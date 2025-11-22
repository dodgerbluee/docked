/**
 * Container Query Service
 * Handles container querying and retrieval operations
 */

const { URL } = require("url");
const portainerService = require("./portainerService");
const dockerRegistryService = require("./dockerRegistryService");
const networkModeService = require("./networkModeService");
const imageUpdateService = require("./imageUpdateService");
const { getAllPortainerInstances, getAllTrackedApps } = require("../db/database");
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
async function getAllContainersWithUpdates(
  forceRefresh = false,
  filterPortainerUrl = null,
  userId = null,
  batchLogger = null
) {
  // Get previous data from normalized tables to compare for newly detected updates
  let previousContainers = null;
  if (forceRefresh && userId) {
    const { getPortainerContainersWithUpdates } = require("../db/database");
    previousContainers = await getPortainerContainersWithUpdates(userId);
    // Clear Docker Hub digest cache to ensure fresh data when force refreshing
    // This prevents stale cached digests from causing false positives when containers
    // were updated outside the app (e.g., manually via Portainer or docker pull)
    dockerRegistryService.clearAllDigestCache();
  }

  // Get tracked apps to determine update source type (GitHub vs GitLab vs Docker Hub)
  // Create a map of imageRepo -> { source_type, github_repo, gitlab_repo } for quick lookup
  const trackedAppsMap = new Map();
  if (userId) {
    try {
      const imageRepoParser = require("../utils/imageRepoParser");
      const trackedApps = await getAllTrackedApps(userId);
      trackedApps.forEach((app) => {
        if (app.image_name && (app.source_type === "github" || app.source_type === "gitlab")) {
          // Use the same parser to normalize imageRepo for consistent matching
          try {
            const parsed = imageRepoParser.parseImageName(app.image_name);
            const imageRepo = parsed.imageRepo;
            // Map all GitHub/GitLab-tracked apps (not just those with has_update)
            // The container's update detection is independent
            trackedAppsMap.set(imageRepo, {
              source_type: app.source_type,
              github_repo: app.github_repo,
              gitlab_repo: app.source_type === "gitlab" ? app.github_repo : null, // Reusing github_repo field for GitLab
            });
            // Also try matching without registry prefix for Docker Hub images that come from GitHub/GitLab
            // e.g., if image_name is "owner/repo:tag" but container uses "ghcr.io/owner/repo:tag"
            if (parsed.registry === "docker.io" && parsed.namespace) {
              // Try matching as "namespace/repository" format
              const dockerHubFormat = `${parsed.namespace}/${parsed.repository}`;
              if (dockerHubFormat !== imageRepo) {
                trackedAppsMap.set(dockerHubFormat, {
                  source_type: app.source_type,
                  github_repo: app.github_repo,
                  gitlab_repo: app.source_type === "gitlab" ? app.github_repo : null,
                });
              }
            }
          } catch (parseError) {
            // Fallback to simple split if parsing fails
            const imageParts = app.image_name.includes(":") ? app.image_name.split(":") : [app.image_name];
            const imageRepo = imageParts[0];
            trackedAppsMap.set(imageRepo, {
              source_type: app.source_type,
              github_repo: app.github_repo,
              gitlab_repo: app.source_type === "gitlab" ? app.github_repo : null,
            });
          }
        }
      });
    } catch (error) {
      logger.debug("Error fetching tracked apps for source type mapping:", error);
    }
  }

  // Check cache first unless force refresh is requested
  if (!forceRefresh) {
    // If userId is provided, try to use normalized tables first (per-user data)
    if (userId) {
      const { getPortainerContainersWithUpdates } = require("../db/database");
      const normalizedContainers = await getPortainerContainersWithUpdates(userId);

      if (normalizedContainers && normalizedContainers.length > 0) {
        // We have data in normalized tables - format it for the frontend
        const userInstances = await getAllPortainerInstances(userId);

        // Create instance map for quick lookup
        const instanceMap = new Map(userInstances.map((inst) => [inst.id, inst]));

        // Format containers to match expected structure
        const formattedContainers = normalizedContainers.map((c) => {
          // Extract tag from imageName (format: repo:tag)
          const imageParts = c.imageName.includes(":")
            ? c.imageName.split(":")
            : [c.imageName, "latest"];
          const currentTag = imageParts[1];

          // Get instance info
          const instance = instanceMap.get(c.portainerInstanceId);

          // Check if this container's update comes from a GitHub/GitLab-tracked app
          let updateSourceType = null;
          let updateGitHubRepo = null;
          let updateGitLabRepo = null;
          if (c.hasUpdate && c.imageRepo) {
            // Try exact match first
            let trackedAppInfo = trackedAppsMap.get(c.imageRepo);
            
            // If no exact match, try normalizing the container's imageRepo
            if (!trackedAppInfo && c.imageName) {
              try {
                const imageRepoParser = require("../utils/imageRepoParser");
                const parsed = imageRepoParser.parseImageName(c.imageName);
                trackedAppInfo = trackedAppsMap.get(parsed.imageRepo);
              } catch (parseError) {
                // If parsing fails, continue without match
              }
            }
            
            if (trackedAppInfo) {
              if (trackedAppInfo.source_type === "github") {
                updateSourceType = "github";
                updateGitHubRepo = trackedAppInfo.github_repo;
              } else if (trackedAppInfo.source_type === "gitlab") {
                updateSourceType = "gitlab";
                updateGitLabRepo = trackedAppInfo.gitlab_repo;
              }
            }
          }
          
          // Also check if provider is gitlab (from registry detection)
          if (!updateSourceType && c.provider === "gitlab") {
            updateSourceType = "gitlab";
          }

          return {
            id: c.containerId,
            name: c.containerName,
            image: c.imageName,
            status: c.status,
            state: c.state,
            endpointId: c.endpointId,
            portainerUrl: instance ? instance.url : null,
            portainerName: instance ? instance.name : null,
            hasUpdate: c.hasUpdate || false,
            currentTag: currentTag,
            currentVersion: currentTag,
            currentDigest: c.currentDigest,
            latestTag: c.latestTag || currentTag,
            newVersion: c.latestVersion || c.latestTag || currentTag,
            latestDigest: c.latestDigest,
            latestDigestFull: c.latestDigest,
            latestPublishDate: c.latestPublishDate,
            currentVersionPublishDate: null,
            currentImageCreated: c.imageCreatedDate,
            imageRepo: c.imageRepo,
            stackName: c.stackName,
            existsInDockerHub: c.latestDigest ? true : false,
            usesNetworkMode: c.usesNetworkMode || false,
            providesNetwork: c.providesNetwork || false,
            provider: c.provider || null, // Provider used to get version info (dockerhub, ghcr, gitlab, github-releases, etc.)
            updateSourceType: updateSourceType,
            updateGitHubRepo: updateGitHubRepo,
            updateGitLabRepo: updateGitLabRepo,
          };
        });

        // Group containers by stack
        const stacksMap = new Map();
        const unstackedContainers = [];
        for (const container of formattedContainers) {
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

        // Build portainerInstances array
        const portainerInstancesArray = userInstances.map((instance) => {
          const instanceContainers = formattedContainers.filter(
            (c) => c.portainerUrl === instance.url
          );
          const withUpdates = instanceContainers.filter((c) => c.hasUpdate);
          const upToDate = instanceContainers.filter((c) => !c.hasUpdate);
          return {
            id: instance.id,
            name: instance.name,
            url: instance.url,
            containers: instanceContainers,
            withUpdates: withUpdates,
            upToDate: upToDate,
            totalContainers: instanceContainers.length,
          };
        });

        // Get unused images count
        const unusedImages = await getUnusedImages();
        const unusedImagesCount = unusedImages.length;

        return {
          grouped: true,
          stacks: stacks,
          containers: formattedContainers,
          portainerInstances: portainerInstancesArray,
          unusedImagesCount: unusedImagesCount,
        };
      }
    }

    // No normalized data found - return empty result instead of fetching from Docker Hub
    // User must explicitly click "Pull" or batch process must run to fetch fresh data
    if (process.env.DEBUG) {
      logger.debug(
        'No normalized data found, returning empty result. User must click "Pull" to fetch data.'
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
    // Return empty result
    return {
      grouped: true,
      stacks: [],
      containers: [],
      portainerInstances: [],
      unusedImagesCount: 0,
    };
  }

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

      // Track current container IDs for this instance to clean up deleted containers later
      const currentContainerIds = new Set(containers.map((c) => c.Id));

      // Detect network mode relationships
      const { containerNetworkModes, containerByIdentifier } =
        await networkModeService.detectNetworkModes(containers, portainerUrl, endpointId);

      // Process containers in parallel for speed
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
              endpointId,
              userId
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

            // Check if this container's update comes from a GitHub/GitLab-tracked app
            let updateSourceType = null;
            let updateGitHubRepo = null;
            let updateGitLabRepo = null;
            if (updateInfo.hasUpdate && updateInfo.imageRepo) {
              // Try exact match first
              let trackedAppInfo = trackedAppsMap.get(updateInfo.imageRepo);
              
              // If no exact match, try normalizing the container's imageRepo
              if (!trackedAppInfo) {
                try {
                  const imageRepoParser = require("../utils/imageRepoParser");
                  const parsed = imageRepoParser.parseImageName(imageName);
                  trackedAppInfo = trackedAppsMap.get(parsed.imageRepo);
                } catch (parseError) {
                  // If parsing fails, continue without match
                }
              }
              
              if (trackedAppInfo) {
                if (trackedAppInfo.source_type === "github") {
                  updateSourceType = "github";
                  updateGitHubRepo = trackedAppInfo.github_repo;
                } else if (trackedAppInfo.source_type === "gitlab") {
                  updateSourceType = "gitlab";
                  updateGitLabRepo = trackedAppInfo.gitlab_repo;
                }
              }
            }
            
            // Also check if provider is gitlab (from registry detection)
            if (!updateSourceType && updateInfo.provider === "gitlab") {
              updateSourceType = "gitlab";
            }

            const containerData = {
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
              provider: updateInfo.provider || null, // Provider used to get version info (dockerhub, ghcr, gitlab, github-releases, etc.)
              updateSourceType: updateSourceType, // "github" or "gitlab" if update comes from tracked app
              updateGitHubRepo: updateGitHubRepo, // GitHub repo URL if update comes from GitHub-tracked app
              updateGitLabRepo: updateGitLabRepo, // GitLab repo URL if update comes from GitLab-tracked app
            };

            // Save to normalized tables for persistence across restarts
            // Use transaction to ensure atomicity - both container and version data saved together
            if (userId && instance.id) {
              try {
                const { upsertContainerWithVersion } = require("../db/database");
                const dockerRegistryService = require("./dockerRegistryService");

                // Extract tag from imageName
                const imageParts = imageName.includes(":") ? imageName.split(":") : [imageName, "latest"];
                const imageTag = imageParts[1];

                // Determine registry from provider or imageRepo
                let registry = "docker.io";
                let namespace = null;
                let repository = updateInfo.imageRepo;

                if (updateInfo.provider) {
                  // Map provider name to registry URL
                  const providerRegistryMap = {
                    dockerhub: "docker.io",
                    ghcr: "ghcr.io",
                    gitlab: "registry.gitlab.com",
                    gcr: "gcr.io",
                  };
                  registry = providerRegistryMap[updateInfo.provider] || "docker.io";
                } else if (updateInfo.imageRepo) {
                  // Fallback: detect from imageRepo
                  const registryInfo = dockerRegistryService.detectRegistry(updateInfo.imageRepo);
                  const registryMap = {
                    dockerhub: "docker.io",
                    ghcr: "ghcr.io",
                    gitlab: "registry.gitlab.com",
                    gcr: "gcr.io",
                  };
                  registry = registryMap[registryInfo.type] || "docker.io";
                }

                // Extract namespace/repository if registry is not docker.io
                if (registry !== "docker.io" && updateInfo.imageRepo.includes("/")) {
                  const parts = updateInfo.imageRepo.split("/");
                  if (parts.length >= 2) {
                    namespace = parts[0];
                    repository = parts.slice(1).join("/");
                  }
                }

                // Prepare version data (only latest_* fields, no current_*)
                // Include version data if we have either digest OR version/tag (for GitHub Releases fallback)
                const hasVersionInfo = updateInfo.latestDigestFull || updateInfo.latestTag || updateInfo.newVersion;
                const versionData = updateInfo.imageRepo && hasVersionInfo
                  ? {
                      registry: registry,
                      provider: updateInfo.provider || null, // Track which provider was used (dockerhub, ghcr, gitlab, github-releases, etc.)
                      namespace: namespace,
                      repository: repository,
                      currentTag: imageTag, // Tag we're checking
                      latestTag: updateInfo.latestTag || imageTag,
                      latestVersion: updateInfo.newVersion || updateInfo.latestTag, // Use latestTag if newVersion is null (for GitHub Releases)
                      latestDigest: updateInfo.latestDigestFull || null, // May be null for GitHub Releases
                      latestPublishDate: updateInfo.latestPublishDate,
                      existsInRegistry: updateInfo.existsInRegistry || updateInfo.existsInDockerHub || false,
                    }
                  : null;

                // Log version data creation for debugging
                if (updateInfo.imageRepo) {
                  logger.info(`[REGISTRY_VERSION_DEBUG] Preparing version data for ${updateInfo.imageRepo}:${imageTag}`, {
                    hasVersionInfo,
                    hasDigest: !!updateInfo.latestDigestFull,
                    hasTag: !!updateInfo.latestTag,
                    hasVersion: !!updateInfo.newVersion,
                    provider: updateInfo.provider,
                    isFallback: updateInfo.isFallback,
                    versionDataCreated: !!versionData,
                    latestTag: updateInfo.latestTag,
                    latestVersion: updateInfo.newVersion,
                    latestDigest: updateInfo.latestDigestFull ? updateInfo.latestDigestFull.substring(0, 12) + "..." : null,
                    currentTag: imageTag,
                    updateInfoKeys: Object.keys(updateInfo),
                  });
                  
                  if (!versionData) {
                    logger.warn(`[REGISTRY_VERSION_DEBUG] No version data created for ${updateInfo.imageRepo}:${imageTag} - missing required info`, {
                      imageRepo: updateInfo.imageRepo,
                      imageTag: imageTag,
                      latestDigestFull: updateInfo.latestDigestFull,
                      latestTag: updateInfo.latestTag,
                      newVersion: updateInfo.newVersion,
                      hasVersionInfo: hasVersionInfo,
                      condition: `updateInfo.imageRepo && hasVersionInfo`,
                      imageRepoExists: !!updateInfo.imageRepo,
                    });
                  } else {
                    logger.info(`[REGISTRY_VERSION_DEBUG] Version data created successfully for ${updateInfo.imageRepo}:${imageTag}`, {
                      registry: versionData.registry,
                      latestTag: versionData.latestTag,
                      latestVersion: versionData.latestVersion,
                      latestDigest: versionData.latestDigest ? versionData.latestDigest.substring(0, 12) + "..." : null,
                    });
                  }
                }

                // Save container and version data atomically in a single transaction
                await upsertContainerWithVersion(
                  userId,
                  instance.id,
                  {
                    containerId: container.Id,
                    containerName: containerData.name,
                    endpointId: endpointId,
                    imageName: imageName,
                    imageRepo: updateInfo.imageRepo,
                    imageTag: imageTag,
                    status: container.Status,
                    state: container.State,
                    stackName: stackName,
                    currentDigest: updateInfo.currentDigestFull,
                    imageCreatedDate: currentImageCreated,
                    registry: registry,
                    namespace: namespace,
                    repository: repository,
                    usesNetworkMode: usesNetworkMode || false,
                    providesNetwork: providesNetwork || false,
                  },
                  versionData
                );
              } catch (dbError) {
                // Don't fail the entire fetch if database save fails
                logger.error("Error saving container to normalized tables:", { error: dbError });
              }
            }

            return containerData;
          } catch (error) {
            // If rate limit exceeded, propagate the error immediately
            if (error.isRateLimitExceeded) {
              throw error;
            }
            // If a single container fails, log it but return a basic container object
            const containerName = container.Names[0]?.replace("/", "") || container.Id.substring(0, 12);
            logger.warn(
              `Error checking updates for container ${containerName}:`,
              {
                containerName,
                image: container.Image,
                error: error.message,
                stack: process.env.DEBUG ? error.stack : undefined,
              }
            );
            // Return a basic container object without update info
            // Try to check if image exists in Docker Hub even if update check failed
            let existsInDockerHub = false;
            try {
              const imageName = container.Image || "unknown";
              const imageParts = imageName.includes(":")
                ? imageName.split(":")
                : [imageName, "latest"];
              const repo = imageParts[0];
              existsInDockerHub = await dockerRegistryService.checkImageExistsInDockerHub(
                repo,
                userId
              );
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

      // Clean up containers that no longer exist (were deleted from Portainer)
      // This ensures the database only contains containers that actually exist
      if (userId && instance.id && currentContainerIds.size > 0) {
        try {
          const { deletePortainerContainersNotInList } = require("../db/database");
          const deletedCount = await deletePortainerContainersNotInList(
            userId,
            instance.id,
            endpointId,
            Array.from(currentContainerIds)
          );
          if (deletedCount > 0) {
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
            try {
              const { cleanupOrphanedDeployedImages } = require("../db/database");
              const orphanedImages = await cleanupOrphanedDeployedImages(userId);
              if (orphanedImages > 0) {
                logger.debug(`Cleaned up ${orphanedImages} orphaned deployed image(s) for ${instanceName}`);
              }
            } catch (cleanupErr) {
              logger.warn("Error cleaning up orphaned deployed images:", cleanupErr);
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
          const { cleanupOrphanedRegistryVersions } = require("../db/database");
          const orphanedVersions = await cleanupOrphanedRegistryVersions(userId);
          if (orphanedVersions > 0) {
            logger.debug(`Cleaned up ${orphanedVersions} orphaned registry version(s) for user ${userId}`);
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

  // If filtering by specific instance, merge with existing data from normalized tables
  if (filterPortainerUrl && existingContainers) {
    // Get user instances to map portainerInstanceId to URL
    const userInstances = await getAllPortainerInstances(userId);
    const instanceMap = new Map(userInstances.map((inst) => [inst.id, inst]));
    const instanceUrlMap = new Map(userInstances.map((inst) => [inst.url, inst.id]));
    const filteredInstanceId = instanceUrlMap.get(filterPortainerUrl);

    // Remove containers from the filtered instance from existing data
    // Format existing containers to match allContainers structure
    const otherContainers = existingContainers
      .filter((c) => c.portainerInstanceId !== filteredInstanceId)
      .map((c) => {
        const instance = instanceMap.get(c.portainerInstanceId);
        const imageParts = c.imageName.includes(":")
          ? c.imageName.split(":")
          : [c.imageName, "latest"];
        const currentTag = imageParts[1];
        
        // Check if this container's update comes from a GitHub/GitLab-tracked app
        let updateSourceType = null;
        let updateGitHubRepo = null;
        let updateGitLabRepo = null;
        if (c.hasUpdate && c.imageRepo) {
          // Try exact match first
          let trackedAppInfo = trackedAppsMap.get(c.imageRepo);
          
          // If no exact match, try normalizing the container's imageRepo
          if (!trackedAppInfo && c.imageName) {
            try {
              const imageRepoParser = require("../utils/imageRepoParser");
              const parsed = imageRepoParser.parseImageName(c.imageName);
              trackedAppInfo = trackedAppsMap.get(parsed.imageRepo);
            } catch (parseError) {
              // If parsing fails, continue without match
            }
          }
          
          if (trackedAppInfo) {
            if (trackedAppInfo.source_type === "github") {
              updateSourceType = "github";
              updateGitHubRepo = trackedAppInfo.github_repo;
            } else if (trackedAppInfo.source_type === "gitlab") {
              updateSourceType = "gitlab";
              updateGitLabRepo = trackedAppInfo.gitlab_repo;
            }
          }
        }
        
        // Also check if provider is gitlab (from registry detection)
        if (!updateSourceType && c.provider === "gitlab") {
          updateSourceType = "gitlab";
        }
        
        return {
          id: c.containerId,
          name: c.containerName,
          image: c.imageName,
          status: c.status,
          state: c.state,
          endpointId: c.endpointId,
          portainerUrl: instance ? instance.url : null,
          portainerName: instance ? instance.name : null,
          hasUpdate: c.hasUpdate || false,
          currentTag: currentTag,
          currentVersion: currentTag,
          currentDigest: c.currentDigest,
          latestTag: c.latestTag || currentTag,
          newVersion: c.latestVersion || c.latestTag || currentTag,
          latestDigest: c.latestDigest,
          latestDigestFull: c.latestDigest,
          latestPublishDate: c.latestPublishDate,
          currentVersionPublishDate: null,
          currentImageCreated: c.imageCreatedDate,
          imageRepo: c.imageRepo,
          stackName: c.stackName,
          existsInDockerHub: c.latestDigest ? true : false,
          usesNetworkMode: c.usesNetworkMode || false,
          providesNetwork: c.providesNetwork || false,
          provider: c.provider || null, // Provider used to get version info (dockerhub, ghcr, gitlab, github-releases, etc.)
          updateSourceType: updateSourceType,
          updateGitHubRepo: updateGitHubRepo,
          updateGitLabRepo: updateGitLabRepo,
        };
      });

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

    // Recalculate unused images count (we don't store this in normalized tables)
    unusedImagesCount = 0;
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
        logger.error(`Error counting unused images from ${portainerUrl}:`, { error });
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

  // Data is already saved to normalized tables during container processing
  // No need to save to cache anymore

  // Send Discord notifications for newly detected container updates
  if (previousContainers && previousContainers.length > 0) {
    try {
      const discord = getDiscordService();
      if (discord && discord.queueNotification) {
        // Create a map of previous containers by unique identifier
        // Use combination of name, portainerUrl, and endpointId for uniqueness
        // (Name is more stable than ID, which changes after upgrades)
        const previousContainersMap = new Map();
        const userInstances = await getAllPortainerInstances(userId);
        const instanceMap = new Map(userInstances.map((inst) => [inst.id, inst]));

        previousContainers.forEach((container) => {
          // Get portainerUrl from instance
          const instance = instanceMap.get(container.portainerInstanceId);
          const portainerUrl = instance ? instance.url : null;
          // Use name as primary key since container IDs change after upgrades
          const key = `${container.containerName}-${portainerUrl}-${container.endpointId}`;

          // Normalize digest for consistent comparison
          const normalizeDigest = (digest) => {
            if (!digest) return null;
            return digest.replace(/^sha256:/i, "").toLowerCase();
          };

          previousContainersMap.set(key, {
            name: container.containerName,
            portainerUrl: portainerUrl,
            endpointId: container.endpointId,
            hasUpdate: container.hasUpdate || false,
            latestDigest: normalizeDigest(container.latestDigest),
            latestVersion: container.latestVersion || container.latestTag || null,
            currentDigest: normalizeDigest(container.currentDigest),
          });
        });

        // Check each new container for newly detected updates
        for (const container of allContainers) {
          if (container.hasUpdate) {
            // Match by name (more stable than ID which changes after upgrades)
            const key = `${container.name}-${container.portainerUrl}-${container.endpointId}`;
            const previousContainer = previousContainersMap.get(key);

            // Determine if we should notify based on update state changes
            // We notify if:
            // 1. No previous container exists (truly new container)
            // 2. Previous container had hasUpdate: false and now has hasUpdate: true (new update detected)
            // 3. Previous container had hasUpdate: true but the latest digest/version changed (newer update available)
            //
            // We do NOT notify if:
            // - Previous container had hasUpdate: true with the same latest digest/version (already notified)
            // - Container was just upgraded (current digest matches latest digest - handled by upgrade process)
            let shouldNotify = false;
            let isNewlyIdentified = false;

            if (!previousContainer) {
              // New container with update - always notify
              shouldNotify = true;
              isNewlyIdentified = true;
            } else if (!previousContainer.hasUpdate && container.hasUpdate) {
              // Container previously had no update, now has update - new update detected
              shouldNotify = true;
              isNewlyIdentified = true;
            } else if (previousContainer.hasUpdate && container.hasUpdate) {
              // Both had updates - check if the latest version/digest changed
              const previousLatestDigest = previousContainer.latestDigest || null;
              const currentLatestDigest =
                container.latestDigest || container.latestDigestFull || null;
              const previousLatestVersion = previousContainer.latestVersion || null;
              const currentLatestVersion =
                container.latestVersion || container.newVersion || container.latestTag || null;

              // Normalize digests for comparison (remove 'sha256:' prefix if present)
              const normalizeDigest = (digest) => {
                if (!digest) return null;
                return digest.replace(/^sha256:/i, "").toLowerCase();
              };

              const normalizedPreviousDigest = normalizeDigest(previousLatestDigest);
              const normalizedCurrentDigest = normalizeDigest(currentLatestDigest);

              // Notify if digest or version changed (newer update available)
              // Only notify if both values exist and are different
              if (
                normalizedCurrentDigest &&
                normalizedPreviousDigest &&
                normalizedCurrentDigest !== normalizedPreviousDigest
              ) {
                shouldNotify = true;
                isNewlyIdentified = true;
              } else if (
                currentLatestVersion &&
                previousLatestVersion &&
                currentLatestVersion !== previousLatestVersion
              ) {
                shouldNotify = true;
                isNewlyIdentified = true;
              }
              // If neither changed, don't notify (same update still available)
              // Also don't notify if one is null and the other isn't (data inconsistency, not a new update)
            }

            // Log all newly identified upgrades (regardless of Discord notification)
            if (isNewlyIdentified) {
              const imageName = container.image || "Unknown";
              const currentVersion = container.currentVersion || container.currentTag || "Unknown";
              const latestVersion =
                container.newVersion || container.latestTag || container.latestVersion || "Unknown";
              const currentDigest = container.currentDigest || container.currentDigestFull || "N/A";
              const latestDigest = container.latestDigest || container.latestDigestFull || "N/A";

              const logData = {
                module: "containerQueryService",
                operation: "getAllContainersWithUpdates",
                containerName: container.name,
                imageName: imageName,
                currentDigest:
                  currentDigest.length > 12
                    ? currentDigest.substring(0, 12) + "..."
                    : currentDigest,
                latestDigest:
                  latestDigest.length > 12 ? latestDigest.substring(0, 12) + "..." : latestDigest,
                currentVersion: currentVersion,
                latestVersion: latestVersion,
                portainerUrl: container.portainerUrl || "Unknown",
                endpointId: container.endpointId || "Unknown",
                userId: userId || "batch",
              };

              // Use batch logger if available (for batch job logs), otherwise use regular logger
              const logMessage = `Newly identified upgrade: ${container.name} (${imageName}) - ${currentVersion} → ${latestVersion}`;
              if (batchLogger) {
                batchLogger.info(logMessage, logData);
              } else {
                logger.info("Newly identified upgrade detected", logData);
              }
            }

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
                latestDigest: container.latestDigest || container.latestDigestFull || null,
                latestVersionPublishDate: container.latestPublishDate || null,
                releaseUrl: null, // Containers don't have release URLs
                notificationType: "portainer-container",
                userId: userId,
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
            const imageId = details.Image || ""; // Get imageId for use in digest extraction and image details

            // Extract image digest from Image field (format: sha256:...)
            // Use getCurrentImageDigest to get the full digest from RepoDigests (more reliable)
            let currentDigest = null;
            try {
              const dockerRegistryService = require("./dockerRegistryService");
              currentDigest = await dockerRegistryService.getCurrentImageDigest(
                details,
                imageName,
                portainerUrl,
                endpointId
              );
            } catch (digestError) {
              // Fallback to extracting from Image field if getCurrentImageDigest fails
              if (imageId.startsWith("sha256:")) {
                currentDigest = imageId; // Use full digest
              } else if (imageId) {
                currentDigest = `sha256:${imageId}`; // Assume it's a digest without prefix
              }
              logger.debug(
                `Could not get digest via getCurrentImageDigest, using fallback: ${digestError.message}`
              );
            }

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
              currentDigest: currentDigest, // Full digest (sha256:...)
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
            logger.error(`Error processing container ${container.Id}:`, { error });
            return null;
          }
        })
      );

      // Filter out null results
      const validContainers = containersBasic.filter((c) => c !== null);

      // Save containers to database if userId is provided
      if (userId && validContainers.length > 0) {
        const { upsertContainer } = require("../db/database");
        const imageRepoParser = require("../utils/imageRepoParser");
        const dockerRegistryService = require("./dockerRegistryService");

        for (const container of validContainers) {
          try {
            // Parse image repo from image name
            const parsed = imageRepoParser.parseImageName(container.image || "");
            const imageRepo = parsed.repository || container.image?.split(":")[0] || "";
            
            // Extract tag
            const imageParts = container.image?.includes(":") ? container.image.split(":") : [container.image, "latest"];
            const imageTag = imageParts[1];

            // Determine registry
            const registryInfo = dockerRegistryService.detectRegistry(imageRepo);
            const registryMap = {
              dockerhub: "docker.io",
              ghcr: "ghcr.io",
              gitlab: "registry.gitlab.com",
              gcr: "gcr.io",
            };
            const registry = registryMap[registryInfo.type] || "docker.io";
            
            let namespace = null;
            let repository = imageRepo;
            if (registry !== "docker.io" && imageRepo.includes("/")) {
              const parts = imageRepo.split("/");
              if (parts.length >= 2) {
                namespace = parts[0];
                repository = parts.slice(1).join("/");
              }
            }

            // Save container to database (will create deployed_image automatically)
            await upsertContainer(userId, instance.id, {
              containerId: container.id,
              containerName: container.name,
              endpointId: container.endpointId,
              imageName: container.image,
              imageRepo: imageRepo,
              imageTag: imageTag,
              status: container.status,
              state: container.state,
              stackName: container.stackName,
              currentDigest: container.currentDigest || null,
              imageCreatedDate: container.currentImageCreated || null,
              registry: registry,
              namespace: namespace,
              repository: repository,
              usesNetworkMode: container.usesNetworkMode || false,
              providesNetwork: container.providesNetwork || false,
            });
          } catch (saveError) {
            logger.warn(`Failed to save container ${container.name} to database`, {
              error: saveError,
              containerId: container.id,
              instanceId: instance.id,
            });
            // Continue with other containers
          }
        }

        logger.debug(
          `Saved ${validContainers.length} containers to database for instance ${instanceName}`,
          {
            instanceId: instance.id,
            portainerUrl: portainerUrl,
          }
        );
      }

      allContainers.push(...validContainers);
    } catch (error) {
      logger.error(`Error fetching containers from ${portainerUrl}:`, { error });
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

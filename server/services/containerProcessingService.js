/**
 * Container Processing Service
 *
 * Handles processing containers from Portainer instances, including fetching details,
 * checking updates, and formatting container data.
 * Extracted from containerQueryService to improve modularity.
 */

const logger = require("../utils/logger");
const portainerService = require("./portainerService");
const imageUpdateService = require("./imageUpdateService");
const networkModeService = require("./networkModeService");
const containerFormattingService = require("./containerFormattingService");
const containerPersistenceService = require("./containerPersistenceService");
const dockerRegistryService = require("./dockerRegistryService");

/**
 * Process a single container from Portainer
 * @param {Object} params - Parameters object
 * @param {Object} params.container - Container object from Portainer API
 * @param {string} params.portainerUrl - Portainer URL
 * @param {string} params.endpointId - Endpoint ID
 * @param {Object} params.instance - Portainer instance object
 * @param {string} params.instanceName - Instance name
 * @param {Object} params.containerNetworkModes - Network mode relationships
 * @param {number} [params.userId] - User ID (optional)
 * @param {Map<string, Object>} [params.trackedAppsMap] - Map of tracked apps (optional)
 * @returns {Promise<Object>} - Formatted container data
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Container processing requires comprehensive data handling
async function processContainer({
  container,
  portainerUrl,
  endpointId,
  instance,
  instanceName,
  containerNetworkModes,
  userId = null,
  trackedAppsMap = null,
}) {
  try {
    const details = await portainerService.getContainerDetails(
      portainerUrl,
      endpointId,
      container.Id
    );
    const imageName = details.Config.Image;

    // Check for image updates
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

    // Format container data using formatting service
    const containerData = containerFormattingService.formatContainerFromPortainer({
      container,
      updateInfo,
      instance: { name: instanceName, url: portainerUrl },
      portainerUrl,
      endpointId,
      stackName,
      currentImageCreated,
      usesNetworkMode,
      providesNetwork,
      trackedAppsMap,
    });

    // Save to normalized tables for persistence across restarts
    // Extract tag from imageName for persistence service
    const imageParts = imageName.includes(":") ? imageName.split(":") : [imageName, "latest"];
    const imageTag = imageParts[1];

    await containerPersistenceService.saveContainerToDatabase({
      userId,
      portainerInstanceId: instance.id,
      container,
      containerData,
      updateInfo,
      imageName,
      imageTag,
      stackName,
      endpointId,
      currentImageCreated,
      usesNetworkMode,
      providesNetwork,
    });

    return containerData;
  } catch (error) {
    // If rate limit exceeded, propagate the error immediately
    if (error.isRateLimitExceeded) {
      throw error;
    }
    // If a single container fails, log it but return a basic container object
    const containerName = container.Names[0]?.replace("/", "") || container.Id.substring(0, 12);
    logger.warn(`Error checking updates for container ${containerName}:`, {
      containerName,
      image: container.Image,
      error: error.message,
      stack: process.env.DEBUG ? error.stack : undefined,
    });
    // Return a basic container object without update info
    // NOTE: checkImageExistsInDockerHub was removed as part of sunsetting the old Docker Hub REST API
    // We now assume all images exist in some registry (crane/skopeo will handle the check)
    const existsInDockerHub = false; // Legacy field, no longer checked

    return {
      id: container.Id,
      name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
      image: container.Image || "unknown",
      status: container.Status,
      state: container.State,
      endpointId,
      portainerUrl,
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
      existsInDockerHub,
    };
  }
}

/**
 * Process containers from a Portainer instance (without update checks)
 * Used by getContainersFromPortainer for basic container information
 * @param {Object} params - Parameters object
 * @param {Object} params.container - Container object from Portainer API
 * @param {string} params.portainerUrl - Portainer URL
 * @param {string} params.endpointId - Endpoint ID
 * @param {Object} params.instance - Portainer instance object
 * @param {string} params.instanceName - Instance name
 * @param {Object} params.containerNetworkModes - Network mode relationships
 * @param {number} [params.userId] - User ID (optional)
 * @returns {Promise<Object>} - Formatted container data (without update info)
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Container processing requires comprehensive basic processing
async function processContainerBasic({
  container,
  portainerUrl,
  endpointId,
  instance,
  instanceName,
  containerNetworkModes,
  userId = null,
}) {
  try {
    const details = await portainerService.getContainerDetails(
      portainerUrl,
      endpointId,
      container.Id
    );
    const imageName = details.Config.Image;
    const imageId = details.Image || "";

    // Extract image digest
    let currentDigest = null;
    try {
      currentDigest = await dockerRegistryService.getCurrentImageDigest(
        details,
        imageName,
        portainerUrl,
        endpointId,
        userId // Pass userId to enable database-assisted digest matching
      );
    } catch (digestError) {
      // Fallback to extracting from Image field if getCurrentImageDigest fails
      if (imageId.startsWith("sha256:")) {
        currentDigest = imageId;
      } else if (imageId) {
        currentDigest = `sha256:${imageId}`;
      }
      logger.debug(
        `Could not get digest via getCurrentImageDigest, using fallback: ${digestError.message}`
      );
    }

    // Extract tag from image name
    const imageParts = imageName.includes(":") ? imageName.split(":") : [imageName, "latest"];
    let imageTag = imageParts[1];

    // Handle incomplete SHA256 digests
    if (imageTag && imageTag.includes("@sha256") && !imageTag.includes("@sha256:")) {
      imageTag = imageTag.replace("@sha256", "");
      if (!imageTag) {
        imageTag = "latest";
      }
    }

    // Extract stack name from labels
    const labels = details.Config.Labels || {};
    const stackName =
      labels["com.docker.compose.project"] || labels["com.docker.stack.namespace"] || null;

    // Check if container uses network_mode
    const usesNetworkMode = networkModeService.containerUsesNetworkMode(details);

    // Check if container provides network
    const providesNetwork = networkModeService.containerProvidesNetwork(
      container,
      containerNetworkModes
    );

    // Get image creation date
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
        logger.debug(`Could not get image details for ${imageId}: ${imageError.message}`);
      }
    }

    // Parse image repo
    const imageRepoParser = require("../utils/imageRepoParser");
    let imageRepo = null;
    let registry = null;
    let namespace = null;
    let repository = null;

    try {
      const parsed = imageRepoParser.parseImageName(imageName);
      imageRepo = parsed.imageRepo;
      registry = parsed.registry;
      namespace = parsed.namespace;
      repository = parsed.repository;
    } catch (_parseError) {
      // Fallback to simple split if parsing fails
      imageRepo = imageParts[0];
      registry = "docker.io";
    }

    // Extract namespace/repository if registry is not docker.io
    if (registry !== "docker.io" && imageRepo.includes("/")) {
      const parts = imageRepo.split("/");
      if (parts.length >= 2) {
        namespace = parts[0];
        repository = parts.slice(1).join("/");
      }
    }

    // Save container to database (will create deployed_image automatically)
    if (userId && instance.id) {
      try {
        const { upsertContainer } = require("../db/index");
        await upsertContainer(userId, instance.id, {
          containerId: container.Id,
          containerName: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
          endpointId,
          imageName,
          imageRepo,
          imageTag,
          status: container.Status,
          state: container.State,
          stackName,
          currentDigest: currentDigest || null,
          imageCreatedDate: currentImageCreated || null,
          registry,
          namespace,
          repository,
          usesNetworkMode: usesNetworkMode || false,
          providesNetwork: providesNetwork || false,
        });
      } catch (saveError) {
        logger.warn(
          `Failed to save container ${container.Names[0]?.replace("/", "")} to database`,
          {
            error: saveError,
            containerId: container.Id,
            instanceId: instance.id,
          }
        );
      }
    }

    return {
      id: container.Id,
      name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
      image: imageName,
      status: container.Status,
      state: container.State,
      endpointId,
      portainerUrl,
      portainerName: instanceName,
      hasUpdate: false, // No registry check
      currentDigest, // Full digest (sha256:...)
      currentTag: imageTag,
      currentVersion: imageTag,
      latestTag: null,
      newVersion: null,
      latestDigest: null,
      currentDigestFull: currentDigest,
      latestDigestFull: null,
      latestPublishDate: null,
      currentVersionPublishDate: null,
      currentImageCreated,
      imageRepo,
      stackName,
      existsInDockerHub: false, // Unknown without registry check
      usesNetworkMode: usesNetworkMode || false,
      providesNetwork: providesNetwork || false,
    };
  } catch (error) {
    logger.warn(`Error processing container ${container.Names[0]?.replace("/", "")}:`, {
      error: error.message,
      containerId: container.Id,
    });
    // Return basic container object on error
    return {
      id: container.Id,
      name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
      image: container.Image || "unknown",
      status: container.Status,
      state: container.State,
      endpointId,
      portainerUrl,
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
      existsInDockerHub: false,
      usesNetworkMode: false,
      providesNetwork: false,
    };
  }
}

module.exports = {
  processContainer,
  processContainerBasic,
};

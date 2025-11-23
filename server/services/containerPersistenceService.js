/**
 * Container Persistence Service
 *
 * Handles saving container data to the database, including version information.
 * Extracted from containerQueryService to improve modularity.
 */

const logger = require("../utils/logger");
const dockerRegistryService = require("./dockerRegistryService");

/**
 * Prepare version data for database storage
 * @param {Object} updateInfo - Update information from imageUpdateService
 * @param {string} imageName - Full image name (repo:tag)
 * @returns {Object|null} - Version data object or null if no version info available
 */
function prepareVersionData(updateInfo, imageName) {
  if (!updateInfo || !updateInfo.imageRepo) {
    return null;
  }

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

  // Include version data if we have either digest OR version/tag (for GitHub Releases fallback)
  const hasVersionInfo =
    updateInfo.latestDigestFull || updateInfo.latestTag || updateInfo.newVersion;

  if (!hasVersionInfo) {
    return null;
  }

  const versionData = {
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
  };

  // Log version data creation for debugging
  if (updateInfo.imageRepo) {
    logger.info(
      `[REGISTRY_VERSION_DEBUG] Preparing version data for ${updateInfo.imageRepo}:${imageTag}`,
      {
        hasVersionInfo,
        hasDigest: !!updateInfo.latestDigestFull,
        hasTag: !!updateInfo.latestTag,
        hasVersion: !!updateInfo.newVersion,
        provider: updateInfo.provider,
        isFallback: updateInfo.isFallback,
        versionDataCreated: !!versionData,
        latestTag: updateInfo.latestTag,
        latestVersion: updateInfo.newVersion,
        latestDigest: updateInfo.latestDigestFull
          ? updateInfo.latestDigestFull.substring(0, 12) + "..."
          : null,
        currentTag: imageTag,
        updateInfoKeys: Object.keys(updateInfo),
      }
    );

    if (!versionData) {
      logger.warn(
        `[REGISTRY_VERSION_DEBUG] No version data created for ${updateInfo.imageRepo}:${imageTag} - missing required info`,
        {
          imageRepo: updateInfo.imageRepo,
          imageTag: imageTag,
          latestDigestFull: updateInfo.latestDigestFull,
          latestTag: updateInfo.latestTag,
          newVersion: updateInfo.newVersion,
          hasVersionInfo: hasVersionInfo,
          condition: `updateInfo.imageRepo && hasVersionInfo`,
          imageRepoExists: !!updateInfo.imageRepo,
        }
      );
    } else {
      logger.info(
        `[REGISTRY_VERSION_DEBUG] Version data created successfully for ${updateInfo.imageRepo}:${imageTag}`,
        {
          registry: versionData.registry,
          latestTag: versionData.latestTag,
          latestVersion: versionData.latestVersion,
          latestDigest: versionData.latestDigest
            ? versionData.latestDigest.substring(0, 12) + "..."
            : null,
        }
      );
    }
  }

  return versionData;
}

/**
 * Save container and version data to database
 * @param {number} userId - User ID
 * @param {number} portainerInstanceId - Portainer instance ID
 * @param {Object} container - Container object from Portainer API
 * @param {Object} containerData - Formatted container data
 * @param {Object} updateInfo - Update information from imageUpdateService
 * @param {string} imageName - Full image name
 * @param {string} imageTag - Image tag
 * @param {string} stackName - Stack name
 * @param {string} endpointId - Endpoint ID
 * @param {string} currentImageCreated - Image creation date
 * @param {boolean} usesNetworkMode - Whether container uses network mode
 * @param {boolean} providesNetwork - Whether container provides network
 * @returns {Promise<void>}
 */
async function saveContainerToDatabase(
  userId,
  portainerInstanceId,
  container,
  containerData,
  updateInfo,
  imageName,
  imageTag,
  stackName,
  endpointId,
  currentImageCreated,
  usesNetworkMode,
  providesNetwork
) {
  if (!userId || !portainerInstanceId) {
    return;
  }

  try {
    const { upsertContainerWithVersion } = require("../db/index");

    // Prepare version data
    const versionData = prepareVersionData(updateInfo, imageName);

    // Determine registry info for container data
    let registry = "docker.io";
    let namespace = null;
    let repository = updateInfo?.imageRepo || null;

    if (updateInfo?.provider) {
      const providerRegistryMap = {
        dockerhub: "docker.io",
        ghcr: "ghcr.io",
        gitlab: "registry.gitlab.com",
        gcr: "gcr.io",
      };
      registry = providerRegistryMap[updateInfo.provider] || "docker.io";
    } else if (updateInfo?.imageRepo) {
      const registryInfo = dockerRegistryService.detectRegistry(updateInfo.imageRepo);
      const registryMap = {
        dockerhub: "docker.io",
        ghcr: "ghcr.io",
        gitlab: "registry.gitlab.com",
        gcr: "gcr.io",
      };
      registry = registryMap[registryInfo.type] || "docker.io";
    }

    if (registry !== "docker.io" && updateInfo?.imageRepo?.includes("/")) {
      const parts = updateInfo.imageRepo.split("/");
      if (parts.length >= 2) {
        namespace = parts[0];
        repository = parts.slice(1).join("/");
      }
    }

    // Save container and version data atomically in a single transaction
    await upsertContainerWithVersion(
      userId,
      portainerInstanceId,
      {
        containerId: container.Id,
        containerName: containerData.name,
        endpointId: endpointId,
        imageName: imageName,
        imageRepo: updateInfo?.imageRepo,
        imageTag: imageTag,
        status: container.Status,
        state: container.State,
        stackName: stackName,
        currentDigest: updateInfo?.currentDigestFull,
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

module.exports = {
  prepareVersionData,
  saveContainerToDatabase,
};

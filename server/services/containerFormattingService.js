/**
 * Container Formatting Service
 * 
 * Handles formatting and transformation of container data between different representations.
 * Extracted from containerQueryService to improve modularity.
 */

const logger = require("../utils/logger");
const imageRepoParser = require("../utils/imageRepoParser");

/**
 * Build a map of tracked apps for quick lookup by imageRepo
 * @param {Array<Object>} trackedApps - Array of tracked app objects
 * @returns {Map<string, Object>} - Map of imageRepo -> tracked app info
 */
function buildTrackedAppsMap(trackedApps) {
  const trackedAppsMap = new Map();

  if (!trackedApps || trackedApps.length === 0) {
    return trackedAppsMap;
  }

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
        // Also try matching without registry prefix for registry images that come from GitHub/GitLab
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
        const imageParts = app.image_name.includes(":")
          ? app.image_name.split(":")
          : [app.image_name];
        const imageRepo = imageParts[0];
        trackedAppsMap.set(imageRepo, {
          source_type: app.source_type,
          github_repo: app.github_repo,
          gitlab_repo: app.source_type === "gitlab" ? app.github_repo : null,
        });
      }
    }
  });

  return trackedAppsMap;
}

/**
 * Determine update source type (GitHub, GitLab, or Registry) for a container
 * @param {Object} container - Container object with update info
 * @param {Map<string, Object>} trackedAppsMap - Map of tracked apps
 * @param {string} imageName - Image name (optional, for parsing)
 * @param {string} provider - Provider from registry detection (optional)
 * @returns {Object} - Object with updateSourceType, updateGitHubRepo, updateGitLabRepo
 */
function determineUpdateSourceType(container, trackedAppsMap, imageName = null, provider = null) {
  let updateSourceType = null;
  let updateGitHubRepo = null;
  let updateGitLabRepo = null;

  if (container.hasUpdate && container.imageRepo) {
    // Try exact match first
    let trackedAppInfo = trackedAppsMap.get(container.imageRepo);

    // If no exact match, try normalizing the container's imageRepo
    if (!trackedAppInfo && imageName) {
      try {
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
  if (!updateSourceType && provider === "gitlab") {
    updateSourceType = "gitlab";
  }

  return {
    updateSourceType,
    updateGitHubRepo,
    updateGitLabRepo,
  };
}

/**
 * Format a container from database record to frontend format
 * @param {Object} dbContainer - Container record from database
 * @param {Object} instance - Portainer instance object
 * @param {Map<string, Object>} trackedAppsMap - Map of tracked apps (optional)
 * @returns {Object} - Formatted container object
 */
function formatContainerFromDatabase(dbContainer, instance, trackedAppsMap = null) {
  // Extract tag from imageName (format: repo:tag)
  const imageParts = dbContainer.imageName.includes(":")
    ? dbContainer.imageName.split(":")
    : [dbContainer.imageName, "latest"];
  const currentTag = imageParts[1];

  // Determine update source type if tracked apps map is provided
  let updateSourceType = null;
  let updateGitHubRepo = null;
  let updateGitLabRepo = null;

  if (trackedAppsMap) {
    const sourceInfo = determineUpdateSourceType(
      dbContainer,
      trackedAppsMap,
      dbContainer.imageName,
      dbContainer.provider
    );
    updateSourceType = sourceInfo.updateSourceType;
    updateGitHubRepo = sourceInfo.updateGitHubRepo;
    updateGitLabRepo = sourceInfo.updateGitLabRepo;
  }

  return {
    id: dbContainer.containerId,
    name: dbContainer.containerName,
    image: dbContainer.imageName,
    status: dbContainer.status,
    state: dbContainer.state,
    endpointId: dbContainer.endpointId,
    portainerUrl: instance ? instance.url : null,
    portainerName: instance ? instance.name : null,
    hasUpdate: dbContainer.hasUpdate || false,
    currentTag: currentTag,
    currentVersion: currentTag,
    currentDigest: dbContainer.currentDigest,
    latestTag: dbContainer.latestTag || currentTag,
    newVersion: dbContainer.latestVersion || dbContainer.latestTag || currentTag,
    latestDigest: dbContainer.latestDigest,
    latestDigestFull: dbContainer.latestDigest,
    latestPublishDate: dbContainer.latestPublishDate,
    currentVersionPublishDate: null,
    currentImageCreated: dbContainer.imageCreatedDate,
    imageRepo: dbContainer.imageRepo,
    stackName: dbContainer.stackName,
    existsInDockerHub: dbContainer.latestDigest ? true : false,
    usesNetworkMode: dbContainer.usesNetworkMode || false,
    providesNetwork: dbContainer.providesNetwork || false,
    provider: dbContainer.provider || null, // Provider used to get version info (dockerhub, ghcr, gitlab, github-releases, etc.)
    updateSourceType: updateSourceType,
    updateGitHubRepo: updateGitHubRepo,
    updateGitLabRepo: updateGitLabRepo,
    noDigest: dbContainer.noDigest || false, // Flag: container was checked but no digest was returned
    lastChecked: dbContainer.lastChecked || null, // When the registry was last checked for this image
  };
}

/**
 * Format a container from Portainer API response to frontend format
 * @param {Object} container - Container from Portainer API
 * @param {Object} updateInfo - Update information from imageUpdateService
 * @param {Object} instance - Portainer instance object
 * @param {string} portainerUrl - Portainer URL
 * @param {string} endpointId - Endpoint ID
 * @param {string} stackName - Stack name (optional)
 * @param {string} currentImageCreated - Image creation date (optional)
 * @param {boolean} usesNetworkMode - Whether container uses network mode (optional)
 * @param {boolean} providesNetwork - Whether container provides network (optional)
 * @param {Map<string, Object>} trackedAppsMap - Map of tracked apps (optional)
 * @returns {Object} - Formatted container object
 */
function formatContainerFromPortainer(
  container,
  updateInfo,
  instance,
  portainerUrl,
  endpointId,
  stackName = null,
  currentImageCreated = null,
  usesNetworkMode = false,
  providesNetwork = false,
  trackedAppsMap = null
) {
  // Determine update source type if tracked apps map is provided
  let updateSourceType = null;
  let updateGitHubRepo = null;
  let updateGitLabRepo = null;

  if (trackedAppsMap && updateInfo) {
    const sourceInfo = determineUpdateSourceType(
      updateInfo,
      trackedAppsMap,
      updateInfo.imageName || container.Image,
      updateInfo.provider
    );
    updateSourceType = sourceInfo.updateSourceType;
    updateGitHubRepo = sourceInfo.updateGitHubRepo;
    updateGitLabRepo = sourceInfo.updateGitLabRepo;
  }

  return {
    id: container.Id,
    name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
    image: updateInfo?.imageName || container.Image || "unknown",
    status: container.Status,
    state: container.State,
    endpointId: endpointId,
    portainerUrl: portainerUrl,
    portainerName: instance ? instance.name : null,
    hasUpdate: updateInfo?.hasUpdate || false,
    currentTag: updateInfo?.currentTag || null,
    currentVersion: updateInfo?.currentVersion || null,
    currentDigest: updateInfo?.currentDigest || null,
    latestTag: updateInfo?.latestTag || null,
    newVersion: updateInfo?.newVersion || null,
    latestDigest: updateInfo?.latestDigest || null,
    currentDigestFull: updateInfo?.currentDigestFull || null,
    latestDigestFull: updateInfo?.latestDigestFull || null,
    latestPublishDate: updateInfo?.latestPublishDate || null,
    currentVersionPublishDate: updateInfo?.currentVersionPublishDate || null,
    currentImageCreated: currentImageCreated,
    imageRepo: updateInfo?.imageRepo || null,
    stackName: stackName,
    existsInDockerHub: updateInfo?.existsInDockerHub || false,
    usesNetworkMode: usesNetworkMode || false,
    providesNetwork: providesNetwork || false,
    provider: updateInfo?.provider || null,
    updateSourceType: updateSourceType,
    updateGitHubRepo: updateGitHubRepo,
    updateGitLabRepo: updateGitLabRepo,
    noDigest: updateInfo?.noDigest || false,
    lastChecked: updateInfo?.lastChecked || null,
  };
}

module.exports = {
  buildTrackedAppsMap,
  determineUpdateSourceType,
  formatContainerFromDatabase,
  formatContainerFromPortainer,
};


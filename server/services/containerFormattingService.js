/**
 * Container Formatting Service
 *
 * Handles formatting and transformation of container data between different representations.
 * Extracted from containerQueryService to improve modularity.
 */

const imageRepoParser = require("../utils/imageRepoParser");
const { computeHasUpdate } = require("../utils/containerUpdateHelpers");

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

  // eslint-disable-next-line complexity -- Tracked app matching requires multiple conditional checks
  trackedApps.forEach((app) => {
    if (app.image_name && (app.source_type === "github" || app.source_type === "gitlab")) {
      // Use the same parser to normalize imageRepo for consistent matching
      try {
        const parsed = imageRepoParser.parseImageName(app.image_name);
        const { imageRepo } = parsed;
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
      } catch (_parseError) {
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
// eslint-disable-next-line complexity -- Update source type determination requires multiple conditional checks
function determineUpdateSourceType(container, trackedAppsMap, imageName = null, provider = null) {
  let updateSourceType = null;
  let updateGitHubRepo = null;
  let updateGitLabRepo = null;

  // Compute hasUpdate if not already present
  const hasUpdate =
    container.hasUpdate !== undefined ? container.hasUpdate : computeHasUpdate(container);

  if (hasUpdate && container.imageRepo) {
    // Try exact match first
    let trackedAppInfo = trackedAppsMap.get(container.imageRepo);

    // If no exact match, try normalizing the container's imageRepo
    if (!trackedAppInfo && imageName) {
      try {
        const parsed = imageRepoParser.parseImageName(imageName);
        trackedAppInfo = trackedAppsMap.get(parsed.imageRepo);
      } catch (_parseError) {
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
// eslint-disable-next-line max-lines-per-function, complexity -- Container formatting requires comprehensive data transformation
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
    const {
      updateSourceType: sourceType,
      updateGitHubRepo: githubRepo,
      updateGitLabRepo: gitlabRepo,
    } = sourceInfo;
    updateSourceType = sourceType;
    updateGitHubRepo = githubRepo;
    updateGitLabRepo = gitlabRepo;
  }

  // Build container object first, then compute hasUpdate
  const container = {
    id: dbContainer.containerId,
    name: dbContainer.containerName,
    image: dbContainer.imageName,
    status: dbContainer.status,
    state: dbContainer.state,
    endpointId: dbContainer.endpointId,
    portainerUrl: instance ? instance.url : null,
    portainerName: instance ? instance.name : null,
    currentTag,
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
    existsInDockerHub: Boolean(dbContainer.latestDigest),
    usesNetworkMode: dbContainer.usesNetworkMode || false,
    providesNetwork: dbContainer.providesNetwork || false,
    provider: dbContainer.provider || null, // Provider used to get version info (dockerhub, ghcr, gitlab, github-releases, etc.)
    updateSourceType,
    updateGitHubRepo,
    updateGitLabRepo,
    noDigest: dbContainer.noDigest || false, // Flag: container was checked but no digest was returned
    lastChecked: dbContainer.lastChecked || null, // When the registry was last checked for this image
    repoDigests: dbContainer.repoDigests || null, // RepoDigests array for multi-arch update detection
  };

  // Compute hasUpdate on-the-fly from digests (uses repoDigests for multi-arch support)
  container.hasUpdate = computeHasUpdate(container);

  return container;
}

/**
 * Format a container from Portainer API response to frontend format
 * @param {Object} params - Parameters object
 * @param {Object} params.container - Container from Portainer API
 * @param {Object} params.updateInfo - Update information from imageUpdateService
 * @param {Object} params.instance - Portainer instance object
 * @param {string} params.portainerUrl - Portainer URL
 * @param {string} params.endpointId - Endpoint ID
 * @param {string} [params.stackName] - Stack name (optional)
 * @param {string} [params.currentImageCreated] - Image creation date (optional)
 * @param {boolean} [params.usesNetworkMode=false] - Whether container uses network mode (optional)
 * @param {boolean} [params.providesNetwork=false] - Whether container provides network (optional)
 * @param {Map<string, Object>} [params.trackedAppsMap] - Map of tracked apps (optional)
 * @returns {Object} - Formatted container object
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Container formatting requires complex transformation logic
function formatContainerFromPortainer({
  container,
  updateInfo,
  instance,
  portainerUrl,
  endpointId,
  stackName = null,
  currentImageCreated = null,
  usesNetworkMode = false,
  providesNetwork = false,
  trackedAppsMap = null,
}) {
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
    const {
      updateSourceType: sourceType,
      updateGitHubRepo: githubRepo,
      updateGitLabRepo: gitlabRepo,
    } = sourceInfo;
    updateSourceType = sourceType;
    updateGitHubRepo = githubRepo;
    updateGitLabRepo = gitlabRepo;
  }

  // Build container object first, then compute hasUpdate
  const containerObj = {
    id: container.Id,
    name: container.Names[0]?.replace("/", "") || container.Id.substring(0, 12),
    image: updateInfo?.imageName || container.Image || "unknown",
    status: container.Status,
    state: container.State,
    endpointId,
    portainerUrl,
    portainerName: instance ? instance.name : null,
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
    currentImageCreated,
    imageRepo: updateInfo?.imageRepo || null,
    stackName,
    existsInDockerHub: updateInfo?.existsInDockerHub || false,
    usesNetworkMode: usesNetworkMode || false,
    providesNetwork: providesNetwork || false,
    provider: updateInfo?.provider || null,
    updateSourceType,
    updateGitHubRepo,
    updateGitLabRepo,
    noDigest: updateInfo?.noDigest || false,
    lastChecked: updateInfo?.lastChecked || null,
    repoDigests: updateInfo?.repoDigests || null, // CRITICAL: Include for multi-arch update detection
  };

  // Compute hasUpdate on-the-fly from digests (now includes repoDigests check)
  containerObj.hasUpdate = computeHasUpdate(containerObj);

  return containerObj;
}

module.exports = {
  buildTrackedAppsMap,
  determineUpdateSourceType,
  formatContainerFromDatabase,
  formatContainerFromPortainer,
};

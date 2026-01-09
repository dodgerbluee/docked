/**
 * Tracked App Service
 * Handles update checking for tracked apps (Docker, GitHub, and GitLab)
 *
 * Uses the unified registry service with automatic provider selection
 * and fallback strategies for robust update detection.
 */
/* eslint-disable max-lines -- Large service file with comprehensive tracked app update logic */

const registryService = require("./registry");
const githubService = require("./githubService");
const gitlabService = require("./gitlabService");
const { updateTrackedApp } = require("../db/index");
const logger = require("../utils/logger");
const axios = require("axios");
const { getDockerHubCreds } = require("../utils/dockerHubCreds");
const { rateLimitDelay } = require("../utils/rateLimiter");
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
 * Get latest version from Docker Hub API v2 using tags endpoint
 * Uses the latest tag's SHA to identify the version that SHA is also for
 * @param {string} imageRepo - Image repository (e.g., "haveagitgat/tdarr")
 * @param {number} userId - User ID for credentials
 * @returns {Promise<Object|null>} - { latestTag, latestDigest, latestVersion } or null
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Docker Hub tag retrieval requires comprehensive parsing logic
async function getLatestVersionFromDockerHubTags(imageRepo, userId) {
  try {
    // Rate limit delay
    const creds = await getDockerHubCreds(userId);
    const delay = creds.token && creds.username ? 500 : 1000;
    await rateLimitDelay(delay);

    // Parse namespace and repository
    let namespace = "library";
    let repository = imageRepo;

    if (imageRepo.includes("/")) {
      const parts = imageRepo.split("/");
      namespace = parts[0];
      repository = parts.slice(1).join("/");
    }

    // Call Docker Hub API v2 tags endpoint
    const hubApiUrl = `https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags/`;
    const headers = {
      "User-Agent": "Docked/1.0",
    };

    if (creds.token && creds.username) {
      headers.Authorization = `Basic ${Buffer.from(`${creds.username}:${creds.token}`).toString("base64")}`;
    }

    const response = await axios.get(hubApiUrl, {
      headers,
      timeout: 10000,
      validateStatus: (status) => status < 500,
    });

    if (response.status === 429) {
      const error = new Error("Rate limited by Docker Hub");
      error.response = { status: 429 };
      error.isRateLimitExceeded = true;
      throw error;
    }

    if (
      response.status !== 200 ||
      !response.data ||
      !response.data.results ||
      response.data.results.length === 0
    ) {
      logger.warn(`No tags found for ${imageRepo} from Docker Hub API`);
      return null;
    }

    // Get the latest tag (first result is typically the most recent)
    const latestTagInfo = response.data.results[0];
    const latestTag = latestTagInfo.name;

    // Get digest from tag info - prefer main digest, fallback to first image digest
    let latestDigest = latestTagInfo.digest;
    if (
      !latestDigest &&
      latestTagInfo.images &&
      Array.isArray(latestTagInfo.images) &&
      latestTagInfo.images.length > 0
    ) {
      latestDigest = latestTagInfo.images[0].digest;
    }

    if (!latestDigest) {
      logger.warn(`No digest found for latest tag ${latestTag} of ${imageRepo}`);
      return null;
    }

    // Get publish date from latest tag (tag_last_pushed or last_updated)
    const latestPublishDate = latestTagInfo.tag_last_pushed || latestTagInfo.last_updated || null;

    // Normalize digest format for comparison (remove sha256: prefix and compare)
    const normalizeDigest = (digest) => {
      if (!digest) return null;
      return digest.replace(/^sha256:/, "").toLowerCase();
    };

    const normalizedLatestDigest = normalizeDigest(latestDigest);

    // Find all tags that share the same SHA/digest
    // Look for version tags (not "latest") that have the same digest
    let latestVersion = null;
    let latestVersionPublishDate = null;

    // First, check if the latest tag itself is a version tag (not "latest")
    if (latestTag && latestTag !== "latest") {
      latestVersion = latestTag;
      latestVersionPublishDate = latestPublishDate;
    } else {
      // Search through all tags to find one with the same digest that's a version tag
      for (const tagInfo of response.data.results) {
        // Check main digest
        const tagDigest = normalizeDigest(tagInfo.digest);
        if (tagDigest === normalizedLatestDigest) {
          // Found a tag with matching digest
          const isValidVersionTag =
            tagInfo.name && tagInfo.name !== "latest" && tagInfo.name.trim() !== "";
          if (isValidVersionTag) {
            latestVersion = tagInfo.name.trim();
            // Get publish date for this version tag
            latestVersionPublishDate =
              tagInfo.tag_last_pushed || tagInfo.last_updated || latestPublishDate;
            break;
          }
        }

        // Also check individual image digests
        if (!tagInfo.images || !Array.isArray(tagInfo.images)) {
          continue;
        }

        for (const image of tagInfo.images) {
          const imageDigest = normalizeDigest(image.digest);
          if (imageDigest !== normalizedLatestDigest) {
            continue;
          }

          const isValidTagName =
            tagInfo.name && tagInfo.name !== "latest" && tagInfo.name.trim() !== "";
          if (!isValidTagName) {
            continue;
          }

          latestVersion = tagInfo.name.trim();
          // Get publish date for this version tag
          latestVersionPublishDate =
            tagInfo.tag_last_pushed || tagInfo.last_updated || latestPublishDate;
          break;
        }

        if (latestVersion) {
          break;
        }
      }
    }

    // Normalize digest format for return (ensure it starts with sha256:)
    const normalizedDigest = latestDigest.startsWith("sha256:")
      ? latestDigest
      : `sha256:${latestDigest}`;

    return {
      latestTag,
      latestDigest: normalizedDigest,
      latestVersion: latestVersion || latestTag, // Fallback to latestTag if no version tag found
      latestPublishDate: latestVersionPublishDate || latestPublishDate, // Use version tag date if found, otherwise latest tag date
    };
  } catch (error) {
    if (error.isRateLimitExceeded) {
      throw error;
    }
    logger.error(`Error fetching tags from Docker Hub API for ${imageRepo}:`, error.message);
    return null;
  }
}

/**
 * Check for updates on a single tracked image
 * @param {Object} trackedApp - Tracked app object from database
 * @param {Object} batchLogger - Optional batch logger for batch job logs
 * @returns {Promise<Object>} - Update information
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Tracked app checking requires comprehensive update detection logic
async function checkTrackedApp(trackedApp, batchLogger = null) {
  const sourceType = trackedApp.source_type || "docker";

  // Handle GitHub repositories
  if (sourceType === "github" && trackedApp.github_repo) {
    return checkGitHubTrackedApp(trackedApp, batchLogger);
  }

  // Handle GitLab repositories
  if (sourceType === "gitlab" && trackedApp.github_repo) {
    return checkGitLabTrackedApp(trackedApp, batchLogger);
  }

  // Handle Docker Hub images - use new Docker Hub API v2 tags flow
  const imageName = trackedApp.image_name;

  // Extract image name and tag
  const imageParts = imageName.includes(":") ? imageName.split(":") : [imageName, "latest"];
  const repo = imageParts[0];
  const currentTag = imageParts[1];

  const userId = trackedApp.user_id;
  let latestVersionInfo = null;

  try {
    // Use new Docker Hub API v2 tags endpoint flow
    latestVersionInfo = await getLatestVersionFromDockerHubTags(repo, userId);
  } catch (error) {
    // If rate limit exceeded, propagate the error
    if (error.isRateLimitExceeded) {
      throw error;
    }
    // For other errors, continue with null (will assume no update)
    latestVersionInfo = null;
  }

  let hasUpdate = false;
  let latestDigest = null;
  let latestTag = currentTag;
  let latestVersion = null;

  if (latestVersionInfo) {
    latestDigest = latestVersionInfo.latestDigest;
    latestTag = latestVersionInfo.latestTag;
    latestVersion = latestVersionInfo.latestVersion;

    // Determine if there's an update by comparing digests or versions
    if (trackedApp.current_digest) {
      // Compare digests if we have a stored digest
      hasUpdate = trackedApp.current_digest !== latestDigest;
    } else if (trackedApp.current_version && latestVersion) {
      // Compare versions if we have both stored and latest versions
      // Normalize versions for comparison (remove "v" prefix, case-insensitive, trim)
      const normalizeVersion = (v) => {
        if (!v) return "";
        return String(v).replace(/^v/i, "").trim().toLowerCase();
      };
      const normalizedCurrent = normalizeVersion(trackedApp.current_version);
      const normalizedLatest = normalizeVersion(latestVersion);

      // Only consider it an update if normalized versions are different and both are valid
      if (normalizedCurrent !== "" && normalizedLatest !== "") {
        hasUpdate = normalizedCurrent !== normalizedLatest;
      } else {
        // If we can't normalize one or both, fall back to direct string comparison
        hasUpdate = trackedApp.current_version !== latestVersion;
      }
    } else if (trackedApp.current_version) {
      // We have current_version but no latestVersion - no update available yet
      hasUpdate = false;
    } else {
      // First check - no update yet
      hasUpdate = false;
    }
  }

  // Format digest for display (shortened version)
  const formatDigest = (digest) => {
    if (!digest) {
      return null;
    }
    // Return first 12 characters after "sha256:" for display
    return digest.replace("sha256:", "").substring(0, 12);
  };

  // Get publish dates from the tags response or via API call
  let latestPublishDate = latestVersionInfo?.latestPublishDate || null;
  let currentVersionPublishDate = null;

  // If we didn't get publish date from tags response, try fetching it (non-blocking)
  if (!latestPublishDate && latestVersion && hasUpdate) {
    const tagForPublishDate = latestVersion !== "latest" ? latestVersion : latestTag;
    if (tagForPublishDate) {
      try {
        latestPublishDate = await registryService.getTagPublishDate(repo, tagForPublishDate, {
          userId,
          githubRepo: trackedApp.github_repo, // Pass GitHub repo for fallback
        });
      } catch (_error) {
        // Don't fail the entire update check if publish date fetch fails
        latestPublishDate = null;
      }
    }
  }

  // Get publish date for current version (non-blocking - don't fail if this errors)
  if (trackedApp.current_version && trackedApp.current_version !== "latest") {
    try {
      currentVersionPublishDate = await registryService.getTagPublishDate(
        repo,
        trackedApp.current_version,
        {
          userId,
          githubRepo: trackedApp.github_repo, // Pass GitHub repo for fallback
        }
      );
    } catch (_error) {
      // Don't fail the entire update check if publish date fetch fails
      currentVersionPublishDate = null;
    }
  } else if (!trackedApp.current_version && latestVersion && latestVersion !== "latest") {
    // First check - use latest version publish date as current
    currentVersionPublishDate = latestPublishDate;
  }

  // If current version is "latest" and we found the actual version, update it
  // Also update if current version is not set (first check)
  let currentVersionToStore = trackedApp.current_version;
  let currentDigestToStore = trackedApp.current_digest;

  // Update current version if we found a real version (not "latest")
  // On first check (no current version), set it to the latest version we found
  if (latestVersion && latestVersion !== "latest") {
    if (!currentVersionToStore || currentVersionToStore === "latest") {
      currentVersionToStore = latestVersion;
    }
  } else if (!currentVersionToStore && latestVersion) {
    // If we don't have a current version and got a version (even if it's "latest"), set it
    currentVersionToStore = latestVersion;
  }

  // Update current digest if we don't have one yet
  if (!currentDigestToStore && latestDigest) {
    currentDigestToStore = latestDigest;
  }

  // Update the tracked image in database
  // Only update if we successfully got image info
  const updateData = {
    hasUpdate: hasUpdate ? 1 : 0,
    lastChecked: new Date().toISOString(),
  };

  // Only update latestVersion if we have a valid value (not null, not empty, not "latest" unless we couldn't resolve it)
  if (latestVersion) {
    // Convert to string to ensure proper type
    const versionStr = String(latestVersion).trim();
    if (versionStr !== "" && versionStr !== "null" && versionStr !== "undefined") {
      updateData.latestVersion = versionStr;
    }
  }

  if (latestDigest) {
    // Convert to string to ensure proper type
    const digestStr = String(latestDigest).trim();
    if (digestStr !== "" && digestStr !== "null" && digestStr !== "undefined") {
      updateData.latestDigest = digestStr;
    }
  }

  // Update current version/digest if we have better information
  if (currentVersionToStore && currentVersionToStore !== trackedApp.current_version) {
    updateData.currentVersion = currentVersionToStore;
  }
  if (currentDigestToStore && currentDigestToStore !== trackedApp.current_digest) {
    updateData.currentDigest = currentDigestToStore;
  }

  // Store publish dates
  if (currentVersionPublishDate) {
    updateData.currentVersionPublishDate = currentVersionPublishDate;
  }
  if (latestPublishDate) {
    // Only store latestVersionPublishDate if it's different from currentVersionPublishDate
    // or if there's an update
    if (hasUpdate) {
      updateData.latestVersionPublishDate = latestPublishDate;
    } else if (trackedApp.latest_version_publish_date) {
      // If no update but we have existing latest_version_publish_date, clear it
      updateData.latestVersionPublishDate = null;
    }
  } else if (!hasUpdate && trackedApp.latest_version_publish_date) {
    // If no update and no latest publish date, clear existing latest_version_publish_date
    updateData.latestVersionPublishDate = null;
  }

  await updateTrackedApp(trackedApp.id, trackedApp.user_id, updateData);

  // Use the resolved current version (or fallback to stored/currentTag)
  // Ensure we always return a string, never null/undefined
  const displayCurrentVersion = currentVersionToStore
    ? String(currentVersionToStore)
    : trackedApp.current_version
      ? String(trackedApp.current_version)
      : currentTag;

  // Use latestVersion if we have it, otherwise use the stored latest_version or currentTag
  // Ensure we return a string, not null/undefined, and prefer actual versions over "latest"
  let displayLatestVersion = currentTag; // Default fallback
  if (latestVersion && latestVersion !== "latest") {
    displayLatestVersion = String(latestVersion);
  } else if (trackedApp.latest_version && trackedApp.latest_version !== "latest") {
    displayLatestVersion = String(trackedApp.latest_version);
  } else if (trackedApp.latest_version) {
    displayLatestVersion = String(trackedApp.latest_version);
  }

  // Helper function to normalize digests for comparison
  function normalizeDigestForComparison(digest) {
    if (!digest) return "";
    return String(digest)
      .replace(/^sha256:/i, "")
      .toLowerCase()
      .trim();
  }

  // Check if this is a newly detected update (either first time OR a different update than before)
  // Compare latest digest/version with stored values to detect if this is a new update
  const isNewlyDetectedUpdate =
    hasUpdate &&
    (!trackedApp.has_update ||
      // If already had an update, check if the latest digest/version has changed (new update available)
      (latestDigest &&
        trackedApp.latest_digest &&
        normalizeDigestForComparison(latestDigest) !==
          normalizeDigestForComparison(trackedApp.latest_digest)) ||
      (latestVersion && trackedApp.latest_version && latestVersion !== trackedApp.latest_version));

  // Log and send Discord notification if update detected (only if newly detected, not if already had update)
  if (isNewlyDetectedUpdate) {
    // Log newly identified tracked app update
    const currentDigest = trackedApp.current_digest || "N/A";
    const latestDigestFormatted = latestDigest || "N/A";
    const currentDigestShort =
      currentDigest.length > 12 ? `${currentDigest.substring(0, 12)}...` : currentDigest;
    const latestDigestShort =
      latestDigestFormatted.length > 12
        ? `${latestDigestFormatted.substring(0, 12)}...`
        : latestDigestFormatted;

    const logData = {
      module: "trackedAppService",
      operation: "checkTrackedApp",
      trackedAppName: trackedApp.name,
      imageName,
      currentDigest: currentDigestShort,
      latestDigest: latestDigestShort,
      currentVersion: displayCurrentVersion,
      latestVersion: displayLatestVersion,
      userId: trackedApp.user_id || "batch",
    };

    // Use batch logger if available (for batch job logs), otherwise use regular logger
    const logMessage = `New tracked app update found: ${trackedApp.name} (${imageName}) - ${displayCurrentVersion} → ${displayLatestVersion}`;
    if (batchLogger) {
      batchLogger.info(logMessage, logData);
    } else {
      logger.info("New tracked app update detected", logData);
    }

    try {
      const discord = getDiscordService();
      if (discord && discord.queueNotification) {
        await discord.queueNotification({
          id: trackedApp.id,
          name: trackedApp.name,
          imageName,
          githubRepo: null,
          sourceType: "docker",
          currentVersion: displayCurrentVersion,
          latestVersion: displayLatestVersion,
          latestDigest: latestDigest || null,
          latestVersionPublishDate: latestPublishDate,
          notificationType: "tracked-app",
          userId: trackedApp.user_id,
        });
      }
    } catch (error) {
      // Don't fail the update check if notification fails
      logger.error("Error sending Discord notification:", error);
    }
  }

  return {
    id: trackedApp.id,
    name: trackedApp.name,
    imageName,
    currentVersion: displayCurrentVersion,
    currentDigest: formatDigest(currentDigestToStore || trackedApp.current_digest),
    latestVersion: displayLatestVersion,
    latestDigest: formatDigest(latestDigest || trackedApp.latest_digest),
    hasUpdate: Boolean(hasUpdate), // Ensure boolean, not 0/1
    latestPublishDate,
    imageRepo: repo,
  };
}

/**
 * Check for updates on a GitHub tracked image
 * @param {Object} trackedApp - Tracked app object from database
 * @returns {Promise<Object>} - Update information
 */
// eslint-disable-next-line max-lines-per-function, complexity -- GitHub tracked app checking requires comprehensive API handling
async function checkGitHubTrackedApp(trackedApp, batchLogger = null) {
  const githubRepo = trackedApp.github_repo;

  let hasUpdate = false;
  let latestVersion = null;
  let latestRelease = null;
  let currentVersionRelease = null;
  let currentVersionPublishDate = null;

  try {
    // Get latest release from GitHub - ONLY use this for latest version
    latestRelease = await githubService.getLatestRelease(githubRepo);

    // Set latestVersion if we have a release with a tag_name
    // We'll use published_at if available, but don't require it
    if (latestRelease && latestRelease.tag_name) {
      latestVersion = latestRelease.tag_name;

      // Compare with current version to determine if update is available
      // Normalize versions for comparison (remove "v" prefix, case-insensitive, trim)
      // This must match the normalization in trackedAppController.js
      const normalizeVersion = (v) => {
        if (!v) {
          return "";
        }
        return String(v).replace(/^v/i, "").trim().toLowerCase();
      };

      if (trackedApp.current_version) {
        const normalizedCurrent = normalizeVersion(trackedApp.current_version);
        const normalizedLatest = normalizeVersion(latestVersion);
        // If normalized versions are different and both are valid, there's an update
        // If they match (after normalization), there's no update
        const bothVersionsExist = normalizedCurrent !== "" && normalizedLatest !== "";
        if (bothVersionsExist) {
          hasUpdate = normalizedCurrent !== normalizedLatest;
          // Debug logging to help diagnose version comparison issues
          const versionsMatchButHasUpdate =
            normalizedCurrent === normalizedLatest && trackedApp.has_update;
          if (versionsMatchButHasUpdate) {
            logger.debug(
              `[TrackedImage] Version match detected but has_update was true: current="${trackedApp.current_version}" (normalized: "${normalizedCurrent}") vs latest="${latestVersion}" (normalized: "${normalizedLatest}")`
            );
          }
        } else {
          // If we can't normalize one or both versions, default to no update
          // (we can't reliably determine if there's an update)
          hasUpdate = false;
        }

        // Get publish date for current version
        // If normalized versions match and we have published_at, use the latest release date
        const versionsMatch = normalizedCurrent === normalizedLatest;
        if (versionsMatch && latestRelease.published_at) {
          currentVersionPublishDate = latestRelease.published_at;
        } else if (!versionsMatch) {
          // Current version is different from latest, fetch its release info
          // Try both with and without "v" prefix since GitHub tags may vary
          const fetchCurrentVersionRelease = async () => {
            try {
              const currentVersionTag = trackedApp.current_version;
              let release = await githubService.getReleaseByTag(githubRepo, currentVersionTag);

              // If not found and doesn't start with "v", try with "v" prefix
              const needsVPrefix = !release && !currentVersionTag.startsWith("v");
              const needsNoVPrefix = !release && currentVersionTag.startsWith("v");
              if (needsVPrefix) {
                release = await githubService.getReleaseByTag(githubRepo, `v${currentVersionTag}`);
              } else if (needsNoVPrefix) {
                // If not found and starts with "v", try without "v" prefix
                release = await githubService.getReleaseByTag(
                  githubRepo,
                  currentVersionTag.substring(1)
                );
              }
              return release;
            } catch (err) {
              logger.error(`Error fetching current version release for ${githubRepo}:`, err);
              return null;
            }
          };
          try {
            currentVersionRelease = await fetchCurrentVersionRelease();

            const hasPublishedDate = currentVersionRelease && currentVersionRelease.published_at;
            if (hasPublishedDate) {
              currentVersionPublishDate = currentVersionRelease.published_at;
            }
          } catch (err) {
            // Non-blocking - if we can't get current version release, continue
            logger.error(
              `Error fetching current version release for ${githubRepo}:${trackedApp.current_version}:`,
              err.message
            );
          }
        }
      } else {
        // If no current version set, this is the first check - no update yet
        hasUpdate = false;
        // Use latest release date as the current version publish date if available
        if (latestRelease.published_at) {
          currentVersionPublishDate = latestRelease.published_at;
        }
      }
    } else if (latestRelease && !latestRelease.tag_name) {
      // Release exists but has no tag_name - log warning
      logger.warn(`GitHub release for ${githubRepo} has no tag_name - skipping`);
    }
  } catch (error) {
    // If rate limit exceeded, propagate the error
    if (error.message && error.message.includes("rate limit")) {
      throw new Error(error.message);
    }
    // For other errors, log and continue (will show no update)
    logger.error(`Error checking GitHub repo ${githubRepo}:`, { error });
    latestVersion = null;
    latestRelease = null;
  }

  // Update the tracked image in database
  const updateData = {
    hasUpdate: hasUpdate ? 1 : 0,
    lastChecked: new Date().toISOString(),
  };

  // Store latestVersion if we have it from the release
  // Always store it if we have latestVersion and latestRelease, regardless of published_at
  // This ensures we show the latest version even if publish date is missing
  if (latestVersion && latestRelease) {
    const versionStr = String(latestVersion).trim();
    if (versionStr !== "" && versionStr !== "null" && versionStr !== "undefined") {
      updateData.latestVersion = versionStr;
    }
  } else if (hasUpdate && trackedApp.latest_version) {
    // If we have an update but couldn't get latest version, preserve existing latest_version
    // This prevents clearing the version when there's a known update
    updateData.latestVersion = trackedApp.latest_version;
  }
  // Don't clear latestVersion - always preserve it if it exists in the database
  // This prevents losing version information when API calls fail or return no data

  // Update current version if we don't have one yet
  let currentVersionToStore = trackedApp.current_version;
  // Normalize versions for comparison (must match normalization in checkGitHubTrackedApp)
  const normalizeVersionForComparison = (v) => {
    if (!v) {
      return "";
    }
    return String(v).replace(/^v/i, "").trim().toLowerCase();
  };

  if (!currentVersionToStore && latestVersion && latestRelease && latestRelease.published_at) {
    currentVersionToStore = latestVersion;
    updateData.currentVersion = latestVersion;
    currentVersionPublishDate = latestRelease.published_at;
  } else if (
    currentVersionToStore &&
    latestVersion &&
    latestRelease &&
    latestRelease.published_at
  ) {
    // If normalized current version matches normalized latest version, use latest release publish date
    const normalizedCurrent = normalizeVersionForComparison(currentVersionToStore);
    const normalizedLatest = normalizeVersionForComparison(latestVersion);
    if (normalizedCurrent === normalizedLatest) {
      currentVersionPublishDate = latestRelease.published_at;
    }
  }

  // Store current version publish date if we have it
  if (currentVersionPublishDate) {
    updateData.currentVersionPublishDate = currentVersionPublishDate;
  }

  // Also store latest version publish date if we have it and it's different from current
  // This ensures we can display the release date for the latest version
  if (latestRelease && latestRelease.published_at && latestVersion) {
    // Normalize versions for comparison
    const normalizedCurrent = normalizeVersionForComparison(currentVersionToStore || "");
    const normalizedLatest = normalizeVersionForComparison(latestVersion);

    // If normalized current version doesn't match normalized latest, store latest's publish date separately
    if (normalizedCurrent !== normalizedLatest) {
      updateData.latestVersionPublishDate = latestRelease.published_at;
    } else {
      // If they match, clear latestVersionPublishDate since currentVersionPublishDate covers it
      updateData.latestVersionPublishDate = null;
    }
  } else if (hasUpdate && trackedApp.latest_version_publish_date) {
    // If we have an update but no published_at, preserve existing latest_version_publish_date
    // This prevents clearing the publish date when there's a known update
    updateData.latestVersionPublishDate = trackedApp.latest_version_publish_date;
  } else {
    // Only clear if we don't have an update
    if (!hasUpdate) {
      updateData.latestVersionPublishDate = null;
    }
  }

  await updateTrackedApp(trackedApp.id, trackedApp.user_id, updateData);

  // Format display values
  const displayCurrentVersion = currentVersionToStore
    ? String(currentVersionToStore)
    : trackedApp.current_version
      ? String(trackedApp.current_version)
      : "Not checked";

  // Show latest version if we have it from the release or from database
  // Always prefer the latestVersion from the release if available
  const displayLatestVersion = latestVersion
    ? String(latestVersion)
    : trackedApp.latest_version
      ? String(trackedApp.latest_version)
      : "Unknown";

  // Check if this is a newly detected update (either first time OR a different update than before)
  // Compare latest version with stored value to detect if this is a new update
  const isNewlyDetectedUpdate =
    hasUpdate &&
    (!trackedApp.has_update ||
      // If already had an update, check if the latest version has changed (new update available)
      (latestVersion && trackedApp.latest_version && latestVersion !== trackedApp.latest_version));

  // Log and send Discord notification if update detected (only if newly detected, not if already had update)
  if (isNewlyDetectedUpdate) {
    // Log newly identified tracked app update
    const logData = {
      module: "trackedAppService",
      operation: "checkGitHubTrackedApp",
      trackedAppName: trackedApp.name,
      githubRepo,
      currentVersion: displayCurrentVersion,
      latestVersion: displayLatestVersion,
      userId: trackedApp.user_id || "batch",
    };

    // Use batch logger if available (for batch job logs), otherwise use regular logger
    const logMessage = `New tracked app update found: ${trackedApp.name} (${githubRepo}) - ${displayCurrentVersion} → ${displayLatestVersion}`;
    if (batchLogger) {
      batchLogger.info(logMessage, logData);
    } else {
      logger.info("New tracked app update detected", logData);
    }

    try {
      const discord = getDiscordService();
      if (discord && discord.queueNotification) {
        await discord.queueNotification({
          id: trackedApp.id,
          name: trackedApp.name,
          imageName: null,
          githubRepo,
          sourceType: "github",
          currentVersion: displayCurrentVersion,
          latestVersion: displayLatestVersion,
          latestVersionPublishDate:
            latestRelease && latestRelease.published_at ? latestRelease.published_at : null,
          releaseUrl: latestRelease?.html_url || null,
          notificationType: "tracked-app",
          userId: trackedApp.user_id,
        });
      }
    } catch (error) {
      // Don't fail the update check if notification fails
      logger.error("Error sending Discord notification:", error);
    }
  }

  return {
    id: trackedApp.id,
    name: trackedApp.name,
    imageName: null,
    githubRepo,
    sourceType: "github",
    currentVersion: displayCurrentVersion,
    currentDigest: null,
    latestVersion: displayLatestVersion,
    latestDigest: null,
    hasUpdate: Boolean(hasUpdate),
    latestPublishDate:
      latestRelease && latestRelease.published_at ? latestRelease.published_at : null,
    currentVersionPublishDate,
    releaseUrl: latestRelease?.html_url || null,
  };
}

/**
 * Check for updates on all tracked images
 * @param {Array} trackedApps - Array of tracked image objects
 * @param {Object} batchLogger - Optional batch logger for batch job logs
 * @returns {Promise<Array>} - Array of update information
 */
async function checkAllTrackedApps(trackedApps, batchLogger = null) {
  const results = [];

  for (const image of trackedApps) {
    try {
      const result = await checkTrackedApp(image, batchLogger);
      results.push(result);
    } catch (error) {
      // If rate limit exceeded, stop processing and propagate error
      if (error.isRateLimitExceeded) {
        throw error;
      }
      // For other errors, log and continue with other images
      logger.error(`Error checking tracked image ${image.name}:`, { error });
      results.push({
        id: image.id,
        name: image.name,
        imageName: image.image_name,
        error: error.message,
      });
    }
  }

  return results;
}

/**
 * Check for updates on a GitLab tracked image
 * @param {Object} trackedApp - Tracked app object from database
 * @returns {Promise<Object>} - Update information
 */
// eslint-disable-next-line max-lines-per-function, complexity -- GitLab tracked app checking requires comprehensive API handling
async function checkGitLabTrackedApp(trackedApp, batchLogger = null) {
  const gitlabRepo = trackedApp.github_repo; // Reusing github_repo field for GitLab repos
  // Get token from repository_access_tokens if repository_token_id is set, otherwise use gitlab_token (backward compatibility)
  let gitlabToken = null;
  if (trackedApp.repository_token_id) {
    const { getRepositoryAccessTokenById } = require("../db/index");
    const tokenRecord = await getRepositoryAccessTokenById(
      trackedApp.repository_token_id,
      trackedApp.user_id
    );
    if (tokenRecord && tokenRecord.provider === "gitlab") {
      gitlabToken = tokenRecord.access_token;
    }
  } else {
    gitlabToken = trackedApp.gitlab_token || null; // Fallback to old gitlab_token field
  }

  let hasUpdate = false;
  let latestVersion = null;
  let latestRelease = null;
  let currentVersionRelease = null;
  let currentVersionPublishDate = null;

  try {
    // Get latest release from GitLab - ONLY use this for latest version
    logger.info(
      `[TrackedImage] Checking GitLab repo: ${gitlabRepo}${gitlabToken ? " (with token)" : ""}`
    );
    latestRelease = await gitlabService.getLatestRelease(gitlabRepo, gitlabToken);
    logger.info(
      `[TrackedImage] GitLab release result: ${latestRelease ? JSON.stringify(latestRelease, null, 2) : "null"}`
    );

    // Set latestVersion if we have a release with a tag_name
    if (latestRelease && latestRelease.tag_name) {
      latestVersion = latestRelease.tag_name;
      logger.info(`[TrackedImage] Extracted latest version from GitLab: ${latestVersion}`);

      // Compare with current version to determine if update is available
      // Normalize versions for comparison (remove "v" prefix, case-insensitive, trim)
      // This must match the normalization in trackedAppController.js
      const normalizeVersion = (v) => {
        if (!v) {
          return "";
        }
        return String(v).replace(/^v/i, "").trim().toLowerCase();
      };

      if (trackedApp.current_version) {
        const normalizedCurrent = normalizeVersion(trackedApp.current_version);
        const normalizedLatest = normalizeVersion(latestVersion);
        // If normalized versions are different and both are valid, there's an update
        // If they match (after normalization), there's no update
        const bothVersionsExist = normalizedCurrent !== "" && normalizedLatest !== "";
        if (bothVersionsExist) {
          hasUpdate = normalizedCurrent !== normalizedLatest;
          // Debug logging to help diagnose version comparison issues
          const versionsMatchButHasUpdate =
            normalizedCurrent === normalizedLatest && trackedApp.has_update;
          if (versionsMatchButHasUpdate) {
            logger.debug(
              `[TrackedImage] Version match detected but has_update was true: current="${trackedApp.current_version}" (normalized: "${normalizedCurrent}") vs latest="${latestVersion}" (normalized: "${normalizedLatest}")`
            );
          }
        } else {
          // If we can't normalize one or both versions, default to no update
          // (we can't reliably determine if there's an update)
          hasUpdate = false;
        }

        // Get publish date for current version
        // If normalized versions match and we have published_at, use the latest release date
        const versionsMatch = normalizedCurrent === normalizedLatest;
        if (versionsMatch && latestRelease.published_at) {
          currentVersionPublishDate = latestRelease.published_at;
        } else if (!versionsMatch) {
          // Current version is different from latest, fetch its release info
          // Try both with and without "v" prefix since GitLab tags may vary
          const fetchCurrentVersionRelease = async () => {
            try {
              const currentVersionTag = trackedApp.current_version;
              let release = await gitlabService.getReleaseByTag(
                gitlabRepo,
                currentVersionTag,
                gitlabToken
              );

              // If not found and doesn't start with "v", try with "v" prefix
              const needsVPrefix = !release && !currentVersionTag.startsWith("v");
              const needsNoVPrefix = !release && currentVersionTag.startsWith("v");
              if (needsVPrefix) {
                release = await gitlabService.getReleaseByTag(
                  gitlabRepo,
                  `v${currentVersionTag}`,
                  gitlabToken
                );
              } else if (needsNoVPrefix) {
                // If not found and starts with "v", try without "v" prefix
                release = await gitlabService.getReleaseByTag(
                  gitlabRepo,
                  currentVersionTag.substring(1),
                  gitlabToken
                );
              }
              return release;
            } catch (err) {
              logger.error(`Error fetching current version release for ${gitlabRepo}:`, err);
              return null;
            }
          };
          try {
            currentVersionRelease = await fetchCurrentVersionRelease();

            const hasPublishedDate = currentVersionRelease && currentVersionRelease.published_at;
            if (hasPublishedDate) {
              currentVersionPublishDate = currentVersionRelease.published_at;
            }
          } catch (err) {
            // Non-blocking - if we can't get current version release, continue
            logger.error(
              `Error fetching current version release for ${gitlabRepo}:${trackedApp.current_version}:`,
              err.message
            );
          }
        }
      } else {
        // If no current version set, this is the first check - no update yet
        hasUpdate = false;
        // Use latest release date as the current version publish date if available
        if (latestRelease.published_at) {
          currentVersionPublishDate = latestRelease.published_at;
        }
      }
    } else if (latestRelease && !latestRelease.tag_name) {
      // Release exists but has no tag_name - log warning
      logger.warn(`[TrackedImage] GitLab release for ${gitlabRepo} has no tag_name - skipping`);
      logger.warn(`[TrackedImage] Release data: ${JSON.stringify(latestRelease, null, 2)}`);
    } else if (!latestRelease) {
      logger.warn(`[TrackedImage] No GitLab release found for ${gitlabRepo}`);
    }
  } catch (error) {
    // If rate limit exceeded, propagate the error
    if (error.message && error.message.includes("rate limit")) {
      throw new Error(error.message);
    }
    // For other errors, log and continue (will show no update)
    logger.error(`Error checking GitLab repo ${gitlabRepo}:`, { error });
    latestVersion = null;
    latestRelease = null;
  }

  // Update the tracked image in database
  const updateData = {
    hasUpdate: hasUpdate ? 1 : 0,
    lastChecked: new Date().toISOString(),
  };

  // Store latestVersion if we have it from the release
  // Always store it if we have latestVersion and latestRelease, regardless of published_at
  // This ensures we show the latest version even if publish date is missing
  if (latestVersion && latestRelease) {
    const versionStr = String(latestVersion).trim();
    if (versionStr !== "" && versionStr !== "null" && versionStr !== "undefined") {
      updateData.latestVersion = versionStr;
    }
  } else if (hasUpdate && trackedApp.latest_version) {
    // If we have an update but couldn't get latest version, preserve existing latest_version
    // This prevents clearing the version when there's a known update
    updateData.latestVersion = trackedApp.latest_version;
  } else if (!hasUpdate && !latestVersion) {
    // Only clear latestVersion if we don't have an update and don't have a latest version
    // This prevents clearing valid version data when there's no update
    updateData.latestVersion = null;
  }

  // Update current version if we don't have one yet
  let currentVersionToStore = trackedApp.current_version;
  // Normalize versions for comparison (must match normalization in checkGitLabTrackedApp)
  const normalizeVersionForComparison = (v) => {
    if (!v) {
      return "";
    }
    return String(v).replace(/^v/i, "").trim().toLowerCase();
  };

  if (!currentVersionToStore && latestVersion && latestRelease && latestRelease.published_at) {
    currentVersionToStore = latestVersion;
    updateData.currentVersion = latestVersion;
    currentVersionPublishDate = latestRelease.published_at;
  } else if (
    currentVersionToStore &&
    latestVersion &&
    latestRelease &&
    latestRelease.published_at
  ) {
    // If normalized current version matches normalized latest version, use latest release publish date
    const normalizedCurrent = normalizeVersionForComparison(currentVersionToStore);
    const normalizedLatest = normalizeVersionForComparison(latestVersion);
    if (normalizedCurrent === normalizedLatest) {
      currentVersionPublishDate = latestRelease.published_at;
    }
  }

  // Store current version publish date if we have it
  if (currentVersionPublishDate) {
    updateData.currentVersionPublishDate = currentVersionPublishDate;
  }

  // Also store latest version publish date if we have it and it's different from current
  // This ensures we can display the release date for the latest version
  if (latestRelease && latestRelease.published_at && latestVersion) {
    // Normalize versions for comparison
    const normalizedCurrent = normalizeVersionForComparison(currentVersionToStore || "");
    const normalizedLatest = normalizeVersionForComparison(latestVersion);

    // If normalized current version doesn't match normalized latest, store latest's publish date separately
    if (normalizedCurrent !== normalizedLatest) {
      updateData.latestVersionPublishDate = latestRelease.published_at;
    } else {
      // If they match, clear latestVersionPublishDate since currentVersionPublishDate covers it
      updateData.latestVersionPublishDate = null;
    }
  } else if (hasUpdate && trackedApp.latest_version_publish_date) {
    // If we have an update but no published_at, preserve existing latest_version_publish_date
    // This prevents clearing the publish date when there's a known update
    updateData.latestVersionPublishDate = trackedApp.latest_version_publish_date;
  } else {
    // Only clear if we don't have an update
    if (!hasUpdate) {
      updateData.latestVersionPublishDate = null;
    }
  }

  await updateTrackedApp(trackedApp.id, trackedApp.user_id, updateData);

  // Format display values
  const displayCurrentVersion = currentVersionToStore
    ? String(currentVersionToStore)
    : trackedApp.current_version
      ? String(trackedApp.current_version)
      : "Not checked";

  // Show latest version if we have it from the release or from database
  // Always prefer the latestVersion from the release if available
  const displayLatestVersion = latestVersion
    ? String(latestVersion)
    : trackedApp.latest_version
      ? String(trackedApp.latest_version)
      : "Unknown";

  // Check if this is a newly detected update (either first time OR a different update than before)
  // Compare latest version with stored value to detect if this is a new update
  const isNewlyDetectedUpdate =
    hasUpdate &&
    (!trackedApp.has_update ||
      // If already had an update, check if the latest version has changed (new update available)
      (latestVersion && trackedApp.latest_version && latestVersion !== trackedApp.latest_version));

  // Log and send Discord notification if update detected (only if newly detected, not if already had update)
  if (isNewlyDetectedUpdate) {
    // Log newly identified tracked app update
    const logData = {
      module: "trackedAppService",
      operation: "checkGitLabTrackedApp",
      trackedAppName: trackedApp.name,
      gitlabRepo,
      currentVersion: displayCurrentVersion,
      latestVersion: displayLatestVersion,
      userId: trackedApp.user_id || "batch",
    };

    // Use batch logger if available (for batch job logs), otherwise use regular logger
    const logMessage = `New tracked app update found: ${trackedApp.name} (${gitlabRepo}) - ${displayCurrentVersion} → ${displayLatestVersion}`;
    if (batchLogger) {
      batchLogger.info(logMessage, logData);
    } else {
      logger.info("New tracked app update detected", logData);
    }

    try {
      const discord = getDiscordService();
      if (discord && discord.queueNotification) {
        await discord.queueNotification({
          id: trackedApp.id,
          name: trackedApp.name,
          imageName: null,
          githubRepo: gitlabRepo,
          sourceType: "gitlab",
          currentVersion: displayCurrentVersion,
          latestVersion: displayLatestVersion,
          latestVersionPublishDate:
            latestRelease && latestRelease.published_at ? latestRelease.published_at : null,
          releaseUrl: latestRelease?.html_url || null,
          notificationType: "tracked-app",
          userId: trackedApp.user_id,
        });
      }
    } catch (error) {
      // Don't fail the update check if notification fails
      logger.error("Error sending Discord notification:", error);
    }
  }

  return {
    id: trackedApp.id,
    name: trackedApp.name,
    imageName: null,
    githubRepo: gitlabRepo,
    sourceType: "gitlab",
    currentVersion: displayCurrentVersion,
    currentDigest: null,
    latestVersion: displayLatestVersion,
    latestDigest: null,
    hasUpdate: Boolean(hasUpdate),
    latestPublishDate:
      latestRelease && latestRelease.published_at ? latestRelease.published_at : null,
    currentVersionPublishDate,
    releaseUrl: latestRelease?.html_url || null,
  };
}

module.exports = {
  checkTrackedApp,
  checkAllTrackedApps,
};

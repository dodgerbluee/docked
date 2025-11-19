/**
 * Tracked Image Service
 * Handles update checking for tracked images (Docker, GitHub, and GitLab)
 */

const dockerRegistryService = require("./dockerRegistryService");
const githubService = require("./githubService");
const gitlabService = require("./gitlabService");
const { updateTrackedImage } = require("../db/database");
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
 * Check for updates on a single tracked image
 * @param {Object} trackedImage - Tracked image object from database
 * @returns {Promise<Object>} - Update information
 */
async function checkTrackedImage(trackedImage) {
  const sourceType = trackedImage.source_type || "docker";

  // Handle GitHub repositories
  if (sourceType === "github" && trackedImage.github_repo) {
    return await checkGitHubTrackedImage(trackedImage);
  }

  // Handle GitLab repositories
  if (sourceType === "gitlab" && trackedImage.github_repo) {
    return await checkGitLabTrackedImage(trackedImage);
  }

  // Handle Docker images (existing logic)
  const imageName = trackedImage.image_name;

  // Extract image name and tag
  const imageParts = imageName.includes(":") ? imageName.split(":") : [imageName, "latest"];
  const repo = imageParts[0];
  const currentTag = imageParts[1];

  // Get the latest image digest from registry (use tracked image's user_id for Docker Hub credentials)
  const userId = trackedImage.user_id;
  let latestImageInfo;
  try {
    latestImageInfo = await dockerRegistryService.getLatestImageDigest(repo, currentTag, userId);
  } catch (error) {
    // If rate limit exceeded, propagate the error
    if (error.isRateLimitExceeded) {
      throw error;
    }
    // For other errors, continue with null (will assume no update)
    latestImageInfo = null;
  }

  let hasUpdate = false;
  let latestDigest = null;
  let latestTag = currentTag;
  let latestVersion = null; // Don't set a default - only set if we successfully get info

  if (latestImageInfo && latestImageInfo.digest) {
    latestDigest = latestImageInfo.digest;
    latestTag = latestImageInfo.tag || currentTag;

    // If the tag is "latest", try to find the actual version tag it points to
    if (latestTag === "latest" && latestDigest) {
      try {
        const actualTag = await dockerRegistryService.getTagFromDigest(repo, latestDigest, userId);
        if (actualTag && actualTag !== "latest" && actualTag.trim() !== "") {
          latestVersion = actualTag.trim();
          latestTag = actualTag.trim(); // Use the actual tag for display
        } else {
          // If we can't find the actual tag, don't set latestVersion (keep as null)
          // This means we'll keep the existing stored version
          latestVersion = null;
        }
      } catch (error) {
        // If we can't find the actual tag, don't update the version
        latestVersion = null;
      }
    } else if (latestTag && latestTag !== "latest") {
      // For non-latest tags, use the tag as the version
      latestVersion = latestTag;
    } else {
      // If tag is still "latest" and we couldn't resolve it, don't update version
      latestVersion = null;
    }

    // Compare digests to determine if update is available
    if (trackedImage.current_digest && latestDigest) {
      // If digests are different, there's an update available
      hasUpdate = trackedImage.current_digest !== latestDigest;
    } else if (latestVersion && latestVersion !== "latest") {
      // Fallback: if we can't compare digests, compare tags (only if we have a real version)
      if (trackedImage.current_version && trackedImage.current_version !== latestVersion) {
        hasUpdate = true;
      }
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

  // Get publish date for latest tag (non-blocking - don't fail if this errors)
  // Use the resolved version tag (not "latest") if available
  let latestPublishDate = null;
  const tagForPublishDate = latestVersion !== "latest" ? latestVersion : latestTag;
  if (tagForPublishDate && hasUpdate) {
    try {
      latestPublishDate = await dockerRegistryService.getTagPublishDate(repo, tagForPublishDate, userId);
    } catch (error) {
      // Don't fail the entire update check if publish date fetch fails
      latestPublishDate = null;
    }
  }

  // If current version is "latest" and we found the actual version, update it
  // Also update if current version is not set
  let currentVersionToStore = trackedImage.current_version;
  let currentDigestToStore = trackedImage.current_digest;

  // Only update current version if we found a real version (not "latest")
  if (latestVersion && latestVersion !== "latest") {
    if (!currentVersionToStore || currentVersionToStore === "latest") {
      currentVersionToStore = latestVersion;
    }
  }

  if (!currentDigestToStore && latestDigest) {
    currentDigestToStore = latestDigest;
  }

  // Update the tracked image in database
  // Only update if we successfully got image info
  const updateData = {
    has_update: hasUpdate ? 1 : 0,
    last_checked: new Date().toISOString(),
  };

  // Only update latest_version if we have a valid value (not null, not empty, not "latest" unless we couldn't resolve it)
  if (latestVersion) {
    // Convert to string to ensure proper type
    const versionStr = String(latestVersion).trim();
    if (versionStr !== "" && versionStr !== "null" && versionStr !== "undefined") {
      updateData.latest_version = versionStr;
    }
  }

  if (latestDigest) {
    // Convert to string to ensure proper type
    const digestStr = String(latestDigest).trim();
    if (digestStr !== "" && digestStr !== "null" && digestStr !== "undefined") {
      updateData.latest_digest = digestStr;
    }
  }

  // Update current version/digest if we have better information
  if (currentVersionToStore && currentVersionToStore !== trackedImage.current_version) {
    updateData.current_version = currentVersionToStore;
  }
  if (currentDigestToStore && currentDigestToStore !== trackedImage.current_digest) {
    updateData.current_digest = currentDigestToStore;
  }

  await updateTrackedImage(trackedImage.id, trackedImage.user_id, updateData);

  // Use the resolved current version (or fallback to stored/currentTag)
  // Ensure we always return a string, never null/undefined
  const displayCurrentVersion = currentVersionToStore
    ? String(currentVersionToStore)
    : trackedImage.current_version
      ? String(trackedImage.current_version)
      : currentTag;

  // Use latestVersion if we have it, otherwise use the stored latest_version or currentTag
  // Ensure we return a string, not null/undefined, and prefer actual versions over "latest"
  let displayLatestVersion = currentTag; // Default fallback
  if (latestVersion && latestVersion !== "latest") {
    displayLatestVersion = String(latestVersion);
  } else if (trackedImage.latest_version && trackedImage.latest_version !== "latest") {
    displayLatestVersion = String(trackedImage.latest_version);
  } else if (trackedImage.latest_version) {
    displayLatestVersion = String(trackedImage.latest_version);
  }

  // Send Discord notification if update detected (only if newly detected, not if already had update)
  if (hasUpdate && !trackedImage.has_update) {
    try {
      const discord = getDiscordService();
      if (discord && discord.queueNotification) {
        await discord.queueNotification({
          id: trackedImage.id,
          name: trackedImage.name,
          imageName: imageName,
          githubRepo: null,
          sourceType: "docker",
          currentVersion: displayCurrentVersion,
          latestVersion: displayLatestVersion,
          latestVersionPublishDate: latestPublishDate,
          notificationType: "tracked-app",
          userId: trackedImage.user_id,
        });
      }
    } catch (error) {
      // Don't fail the update check if notification fails
      logger.error("Error sending Discord notification:", error);
    }
  }

  return {
    id: trackedImage.id,
    name: trackedImage.name,
    imageName: imageName,
    currentVersion: displayCurrentVersion,
    currentDigest: formatDigest(currentDigestToStore || trackedImage.current_digest),
    latestVersion: displayLatestVersion,
    latestDigest: formatDigest(latestDigest || trackedImage.latest_digest),
    hasUpdate: Boolean(hasUpdate), // Ensure boolean, not 0/1
    latestPublishDate: latestPublishDate,
    imageRepo: repo,
  };
}

/**
 * Check for updates on a GitHub tracked image
 * @param {Object} trackedImage - Tracked image object from database
 * @returns {Promise<Object>} - Update information
 */
async function checkGitHubTrackedImage(trackedImage) {
  const githubRepo = trackedImage.github_repo;

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
      // This must match the normalization in trackedImageController.js
      const normalizeVersion = (v) => {
        if (!v) {
          return "";
        }
        return String(v).replace(/^v/i, "").trim().toLowerCase();
      };

      if (trackedImage.current_version) {
        const normalizedCurrent = normalizeVersion(trackedImage.current_version);
        const normalizedLatest = normalizeVersion(latestVersion);
        // If normalized versions are different and both are valid, there's an update
        // If they match (after normalization), there's no update
        if (normalizedCurrent !== "" && normalizedLatest !== "") {
          hasUpdate = normalizedCurrent !== normalizedLatest;
          // Debug logging to help diagnose version comparison issues
          if (normalizedCurrent === normalizedLatest && trackedImage.has_update) {
            logger.debug(
              `[TrackedImage] Version match detected but has_update was true: current="${trackedImage.current_version}" (normalized: "${normalizedCurrent}") vs latest="${latestVersion}" (normalized: "${normalizedLatest}")`
            );
          }
        } else {
          // If we can't normalize one or both versions, default to no update
          // (we can't reliably determine if there's an update)
          hasUpdate = false;
        }

        // Get publish date for current version
        // If normalized versions match and we have published_at, use the latest release date
        if (normalizedCurrent === normalizedLatest && latestRelease.published_at) {
          currentVersionPublishDate = latestRelease.published_at;
        } else if (normalizedCurrent !== normalizedLatest) {
          // Current version is different from latest, fetch its release info
          // Try both with and without "v" prefix since GitHub tags may vary
          try {
            const currentVersionTag = trackedImage.current_version;
            currentVersionRelease = await githubService.getReleaseByTag(
              githubRepo,
              currentVersionTag
            );

            // If not found and doesn't start with "v", try with "v" prefix
            if (!currentVersionRelease && !currentVersionTag.startsWith("v")) {
              currentVersionRelease = await githubService.getReleaseByTag(
                githubRepo,
                `v${currentVersionTag}`
              );
            }
            // If not found and starts with "v", try without "v" prefix
            else if (!currentVersionRelease && currentVersionTag.startsWith("v")) {
              currentVersionRelease = await githubService.getReleaseByTag(
                githubRepo,
                currentVersionTag.substring(1)
              );
            }

            if (currentVersionRelease && currentVersionRelease.published_at) {
              currentVersionPublishDate = currentVersionRelease.published_at;
            }
          } catch (err) {
            // Non-blocking - if we can't get current version release, continue
            logger.error(
              `Error fetching current version release for ${githubRepo}:${trackedImage.current_version}:`,
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
    has_update: hasUpdate ? 1 : 0,
    last_checked: new Date().toISOString(),
  };

  // Store latest_version if we have it from the release
  // Always store it if we have latestVersion and latestRelease, regardless of published_at
  // This ensures we show the latest version even if publish date is missing
  if (latestVersion && latestRelease) {
    const versionStr = String(latestVersion).trim();
    if (versionStr !== "" && versionStr !== "null" && versionStr !== "undefined") {
      updateData.latest_version = versionStr;
    }
  } else if (hasUpdate && trackedImage.latest_version) {
    // If we have an update but couldn't get latest version, preserve existing latest_version
    // This prevents clearing the version when there's a known update
    updateData.latest_version = trackedImage.latest_version;
  } else if (!hasUpdate && !latestVersion) {
    // Only clear latest_version if we don't have an update and don't have a latest version
    // This prevents clearing valid version data when there's no update
    updateData.latest_version = null;
  }

  // Update current version if we don't have one yet
  let currentVersionToStore = trackedImage.current_version;
  // Normalize versions for comparison (must match normalization in checkGitHubTrackedImage)
  const normalizeVersionForComparison = (v) => {
    if (!v) {
      return "";
    }
    return String(v).replace(/^v/i, "").trim().toLowerCase();
  };

  if (!currentVersionToStore && latestVersion && latestRelease && latestRelease.published_at) {
    currentVersionToStore = latestVersion;
    updateData.current_version = latestVersion;
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
    updateData.current_version_publish_date = currentVersionPublishDate;
  }

  // Also store latest version publish date if we have it and it's different from current
  // This ensures we can display the release date for the latest version
  if (latestRelease && latestRelease.published_at && latestVersion) {
    // Normalize versions for comparison
    const normalizedCurrent = normalizeVersionForComparison(currentVersionToStore || "");
    const normalizedLatest = normalizeVersionForComparison(latestVersion);

    // If normalized current version doesn't match normalized latest, store latest's publish date separately
    if (normalizedCurrent !== normalizedLatest) {
      updateData.latest_version_publish_date = latestRelease.published_at;
    } else {
      // If they match, clear latest_version_publish_date since current_version_publish_date covers it
      updateData.latest_version_publish_date = null;
    }
  } else if (hasUpdate && trackedImage.latest_version_publish_date) {
    // If we have an update but no published_at, preserve existing latest_version_publish_date
    // This prevents clearing the publish date when there's a known update
    updateData.latest_version_publish_date = trackedImage.latest_version_publish_date;
  } else {
    // Only clear if we don't have an update
    if (!hasUpdate) {
      updateData.latest_version_publish_date = null;
    }
  }

  await updateTrackedImage(trackedImage.id, trackedImage.user_id, updateData);

  // Format display values
  const displayCurrentVersion = currentVersionToStore
    ? String(currentVersionToStore)
    : trackedImage.current_version
      ? String(trackedImage.current_version)
      : "Not checked";

  // Show latest version if we have it from the release or from database
  // Always prefer the latestVersion from the release if available
  const displayLatestVersion = latestVersion
    ? String(latestVersion)
    : trackedImage.latest_version
      ? String(trackedImage.latest_version)
      : "Unknown";

  // Send Discord notification if update detected (only if newly detected, not if already had update)
  if (hasUpdate && !trackedImage.has_update) {
    try {
      const discord = getDiscordService();
      if (discord && discord.queueNotification) {
        await discord.queueNotification({
          id: trackedImage.id,
          name: trackedImage.name,
          imageName: null,
          githubRepo: githubRepo,
          sourceType: "github",
          currentVersion: displayCurrentVersion,
          latestVersion: displayLatestVersion,
          latestVersionPublishDate:
            latestRelease && latestRelease.published_at ? latestRelease.published_at : null,
          releaseUrl: latestRelease?.html_url || null,
          notificationType: "tracked-app",
          userId: trackedImage.user_id,
        });
      }
    } catch (error) {
      // Don't fail the update check if notification fails
      logger.error("Error sending Discord notification:", error);
    }
  }

  return {
    id: trackedImage.id,
    name: trackedImage.name,
    imageName: null,
    githubRepo: githubRepo,
    sourceType: "github",
    currentVersion: displayCurrentVersion,
    currentDigest: null,
    latestVersion: displayLatestVersion,
    latestDigest: null,
    hasUpdate: Boolean(hasUpdate),
    latestPublishDate:
      latestRelease && latestRelease.published_at ? latestRelease.published_at : null,
    currentVersionPublishDate: currentVersionPublishDate,
    releaseUrl: latestRelease?.html_url || null,
  };
}

/**
 * Check for updates on all tracked images
 * @param {Array} trackedImages - Array of tracked image objects
 * @returns {Promise<Array>} - Array of update information
 */
async function checkAllTrackedImages(trackedImages) {
  const results = [];

  for (const image of trackedImages) {
    try {
      const result = await checkTrackedImage(image);
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
 * @param {Object} trackedImage - Tracked image object from database
 * @returns {Promise<Object>} - Update information
 */
async function checkGitLabTrackedImage(trackedImage) {
  const gitlabRepo = trackedImage.github_repo; // Reusing github_repo field for GitLab repos
  const gitlabToken = trackedImage.gitlab_token || null; // Get token from database

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
      `[TrackedImage] GitLab release result:`,
      latestRelease ? JSON.stringify(latestRelease, null, 2) : "null"
    );

    // Set latestVersion if we have a release with a tag_name
    if (latestRelease && latestRelease.tag_name) {
      latestVersion = latestRelease.tag_name;
      logger.info(`[TrackedImage] Extracted latest version from GitLab: ${latestVersion}`);

      // Compare with current version to determine if update is available
      // Normalize versions for comparison (remove "v" prefix, case-insensitive, trim)
      // This must match the normalization in trackedImageController.js
      const normalizeVersion = (v) => {
        if (!v) {
          return "";
        }
        return String(v).replace(/^v/i, "").trim().toLowerCase();
      };

      if (trackedImage.current_version) {
        const normalizedCurrent = normalizeVersion(trackedImage.current_version);
        const normalizedLatest = normalizeVersion(latestVersion);
        // If normalized versions are different and both are valid, there's an update
        // If they match (after normalization), there's no update
        if (normalizedCurrent !== "" && normalizedLatest !== "") {
          hasUpdate = normalizedCurrent !== normalizedLatest;
          // Debug logging to help diagnose version comparison issues
          if (normalizedCurrent === normalizedLatest && trackedImage.has_update) {
            logger.debug(
              `[TrackedImage] Version match detected but has_update was true: current="${trackedImage.current_version}" (normalized: "${normalizedCurrent}") vs latest="${latestVersion}" (normalized: "${normalizedLatest}")`
            );
          }
        } else {
          // If we can't normalize one or both versions, default to no update
          // (we can't reliably determine if there's an update)
          hasUpdate = false;
        }

        // Get publish date for current version
        // If normalized versions match and we have published_at, use the latest release date
        if (normalizedCurrent === normalizedLatest && latestRelease.published_at) {
          currentVersionPublishDate = latestRelease.published_at;
        } else if (normalizedCurrent !== normalizedLatest) {
          // Current version is different from latest, fetch its release info
          // Try both with and without "v" prefix since GitLab tags may vary
          try {
            const currentVersionTag = trackedImage.current_version;
            currentVersionRelease = await gitlabService.getReleaseByTag(
              gitlabRepo,
              currentVersionTag,
              gitlabToken
            );

            // If not found and doesn't start with "v", try with "v" prefix
            if (!currentVersionRelease && !currentVersionTag.startsWith("v")) {
              currentVersionRelease = await gitlabService.getReleaseByTag(
                gitlabRepo,
                `v${currentVersionTag}`,
                gitlabToken
              );
            }
            // If not found and starts with "v", try without "v" prefix
            else if (!currentVersionRelease && currentVersionTag.startsWith("v")) {
              currentVersionRelease = await gitlabService.getReleaseByTag(
                gitlabRepo,
                currentVersionTag.substring(1),
                gitlabToken
              );
            }

            if (currentVersionRelease && currentVersionRelease.published_at) {
              currentVersionPublishDate = currentVersionRelease.published_at;
            }
          } catch (err) {
            // Non-blocking - if we can't get current version release, continue
            logger.error(
              `Error fetching current version release for ${gitlabRepo}:${trackedImage.current_version}:`,
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
      logger.warn(`[TrackedImage] Release data:`, JSON.stringify(latestRelease, null, 2));
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
    has_update: hasUpdate ? 1 : 0,
    last_checked: new Date().toISOString(),
  };

  // Store latest_version if we have it from the release
  // Always store it if we have latestVersion and latestRelease, regardless of published_at
  // This ensures we show the latest version even if publish date is missing
  if (latestVersion && latestRelease) {
    const versionStr = String(latestVersion).trim();
    if (versionStr !== "" && versionStr !== "null" && versionStr !== "undefined") {
      updateData.latest_version = versionStr;
    }
  } else if (hasUpdate && trackedImage.latest_version) {
    // If we have an update but couldn't get latest version, preserve existing latest_version
    // This prevents clearing the version when there's a known update
    updateData.latest_version = trackedImage.latest_version;
  } else if (!hasUpdate && !latestVersion) {
    // Only clear latest_version if we don't have an update and don't have a latest version
    // This prevents clearing valid version data when there's no update
    updateData.latest_version = null;
  }

  // Update current version if we don't have one yet
  let currentVersionToStore = trackedImage.current_version;
  // Normalize versions for comparison (must match normalization in checkGitLabTrackedImage)
  const normalizeVersionForComparison = (v) => {
    if (!v) {
      return "";
    }
    return String(v).replace(/^v/i, "").trim().toLowerCase();
  };

  if (!currentVersionToStore && latestVersion && latestRelease && latestRelease.published_at) {
    currentVersionToStore = latestVersion;
    updateData.current_version = latestVersion;
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
    updateData.current_version_publish_date = currentVersionPublishDate;
  }

  // Also store latest version publish date if we have it and it's different from current
  // This ensures we can display the release date for the latest version
  if (latestRelease && latestRelease.published_at && latestVersion) {
    // Normalize versions for comparison
    const normalizedCurrent = normalizeVersionForComparison(currentVersionToStore || "");
    const normalizedLatest = normalizeVersionForComparison(latestVersion);

    // If normalized current version doesn't match normalized latest, store latest's publish date separately
    if (normalizedCurrent !== normalizedLatest) {
      updateData.latest_version_publish_date = latestRelease.published_at;
    } else {
      // If they match, clear latest_version_publish_date since current_version_publish_date covers it
      updateData.latest_version_publish_date = null;
    }
  } else if (hasUpdate && trackedImage.latest_version_publish_date) {
    // If we have an update but no published_at, preserve existing latest_version_publish_date
    // This prevents clearing the publish date when there's a known update
    updateData.latest_version_publish_date = trackedImage.latest_version_publish_date;
  } else {
    // Only clear if we don't have an update
    if (!hasUpdate) {
      updateData.latest_version_publish_date = null;
    }
  }

  await updateTrackedImage(trackedImage.id, trackedImage.user_id, updateData);

  // Format display values
  const displayCurrentVersion = currentVersionToStore
    ? String(currentVersionToStore)
    : trackedImage.current_version
      ? String(trackedImage.current_version)
      : "Not checked";

  // Show latest version if we have it from the release or from database
  // Always prefer the latestVersion from the release if available
  const displayLatestVersion = latestVersion
    ? String(latestVersion)
    : trackedImage.latest_version
      ? String(trackedImage.latest_version)
      : "Unknown";

  // Send Discord notification if update detected (only if newly detected, not if already had update)
  if (hasUpdate && !trackedImage.has_update) {
    try {
      const discord = getDiscordService();
      if (discord && discord.queueNotification) {
        await discord.queueNotification({
          id: trackedImage.id,
          name: trackedImage.name,
          imageName: null,
          githubRepo: gitlabRepo,
          sourceType: "gitlab",
          currentVersion: displayCurrentVersion,
          latestVersion: displayLatestVersion,
          latestVersionPublishDate:
            latestRelease && latestRelease.published_at ? latestRelease.published_at : null,
          releaseUrl: latestRelease?.html_url || null,
          notificationType: "tracked-app",
          userId: trackedImage.user_id,
        });
      }
    } catch (error) {
      // Don't fail the update check if notification fails
      logger.error("Error sending Discord notification:", error);
    }
  }

  return {
    id: trackedImage.id,
    name: trackedImage.name,
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
    currentVersionPublishDate: currentVersionPublishDate,
    releaseUrl: latestRelease?.html_url || null,
  };
}

module.exports = {
  checkTrackedImage,
  checkAllTrackedImages,
};

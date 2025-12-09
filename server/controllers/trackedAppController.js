/**
 * Tracked Apps Controller
 * Handles CRUD operations for tracked apps
 */

const {
  getAllTrackedApps,
  getTrackedAppById,
  getTrackedAppByImageName,
  createTrackedApp,
  updateTrackedApp,
  deleteTrackedApp,
} = require("../db/index");
// const { validateRequiredFields } = require("../utils/validation"); // Unused
const trackedAppService = require("../services/trackedAppService");
const githubService = require("../services/githubService");
const gitlabService = require("../services/gitlabService");
const { clearLatestVersionsForAllTrackedApps } = require("../db/index");

/**
 * Create a tracked GitHub app
 * @param {number} userId - User ID
 * @param {string} name - App name
 * @param {string} githubRepo - GitHub repository
 * @param {string} currentVersion - Current version (optional)
 * @param {number} repositoryTokenId - Repository token ID (optional)
 * @returns {Promise<Object>} - Result with id and message
 */
async function createGitHubTrackedApp(userId, name, githubRepo, currentVersion, repositoryTokenId) {
  const trimmedRepo = githubRepo.trim();
  const existing = await getTrackedAppByImageName(userId, null, trimmedRepo);
  if (existing) {
    return {
      error: { status: 400, message: "This GitHub repository is already being tracked" },
    };
  }

  const id = await createTrackedApp({
    userId,
    name: name.trim(),
    imageName: null,
    githubRepo: trimmedRepo,
    sourceType: "github",
    gitlabToken: null,
    repositoryTokenId: repositoryTokenId || null,
  });

  if (currentVersion && currentVersion.trim()) {
    await updateTrackedApp(id, userId, { current_version: currentVersion.trim() });
  }

  return { id, message: "GitHub repository tracked successfully" };
}

/**
 * Create a tracked GitLab app
 * @param {number} userId - User ID
 * @param {string} name - App name
 * @param {string} gitlabRepo - GitLab repository
 * @param {string} currentVersion - Current version (optional)
 * @param {string} gitlabToken - GitLab token (optional)
 * @param {number} repositoryTokenId - Repository token ID (optional)
 * @returns {Promise<Object>} - Result with id and message
 */
async function createGitLabTrackedApp(
  userId,
  name,
  gitlabRepo,
  currentVersion,
  gitlabToken,
  repositoryTokenId
) {
  const trimmedRepo = gitlabRepo.trim();
  const existing = await getTrackedAppByImageName(userId, null, trimmedRepo);
  if (existing) {
    return {
      error: { status: 400, message: "This GitLab repository is already being tracked" },
    };
  }

  const id = await createTrackedApp({
    userId,
    name: name.trim(),
    imageName: null,
    githubRepo: trimmedRepo,
    sourceType: "gitlab",
    gitlabToken: gitlabToken || null,
    repositoryTokenId: repositoryTokenId || null,
  });

  if (currentVersion && currentVersion.trim()) {
    await updateTrackedApp(id, userId, { current_version: currentVersion.trim() });
  }

  return { id, message: "GitLab repository tracked successfully" };
}

/**
 * Create a tracked Docker app
 * @param {number} userId - User ID
 * @param {string} name - App name
 * @param {string} imageName - Docker image name
 * @param {string} currentVersion - Current version (optional)
 * @returns {Promise<Object>} - Result with id and message
 */
async function createDockerTrackedApp(userId, name, imageName, currentVersion) {
  const trimmedImageName = imageName.trim();
  const existing = await getTrackedAppByImageName(userId, trimmedImageName);
  if (existing) {
    return {
      error: { status: 400, message: "An image with this name is already being tracked" },
    };
  }

  const id = await createTrackedApp({
    userId,
    name: name.trim(),
    imageName: trimmedImageName,
    githubRepo: null,
    sourceType: "docker",
  });

  if (currentVersion && currentVersion.trim()) {
    await updateTrackedApp(id, userId, { current_version: currentVersion.trim() });
  }

  return { id, message: "Docker image tracked successfully" };
}

/**
 * Format a tracked app for API response
 * @param {Object} image - Tracked app from database
 * @returns {Object} - Formatted tracked app
 */
function formatTrackedAppForResponse(image) {
  const latestVersion = image.latest_version ? String(image.latest_version) : null;
  const currentVersionPublishDate = image.current_version_publish_date || null;
  const latestVersionPublishDate = image.latest_version_publish_date || null;

  // For GitHub and GitLab repos, ensure we have publish date for latest version when it's different from current
  // This ensures we can show the release date for the latest version
  const isGitSource = image.source_type === "github" || image.source_type === "gitlab";
  if (isGitSource && latestVersion) {
    // Normalize versions for comparison (remove "v" prefix)
    const normalizeVersion = (v) => (v ? v.replace(/^v/, "") : "");
    const normalizedCurrent = normalizeVersion(image.current_version || "");
    const normalizedLatest = normalizeVersion(latestVersion);

    // If latest version is different from current and has no publish date, we should still show it
    // but we need to make sure we have the publish date stored
    // The issue is that latest_version_publish_date should be set when there's an update
    const versionsDiffer = normalizedCurrent !== normalizedLatest;
    if (versionsDiffer && !latestVersionPublishDate) {
      // If we have latest_version but no latest_version_publish_date,
      // it means the update check didn't properly store it
      // We should still show the version, but the publish date will be "Not available"
    }
  }

  return {
    ...image,
    has_update: Boolean(image.has_update), // Convert 0/1 to boolean
    current_version: image.current_version ? String(image.current_version) : null,
    latest_version: latestVersion,
    source_type: image.source_type || "docker", // Default to 'docker' for existing records
    github_repo: image.github_repo || null,
    gitlab_token: image.gitlab_token || null,
    currentVersionPublishDate,
    latestVersionPublishDate,
  };
}

/**
 * Get all tracked apps
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getTrackedApps(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const images = await getAllTrackedApps(userId);
    // Ensure proper data types - convert has_update from integer to boolean
    // and ensure version strings are properly formatted
    const formattedImages = images.map((image) => formatTrackedAppForResponse(image));
    return res.json({
      success: true,
      images: formattedImages,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get a single tracked app
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getTrackedApp(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const { id } = req.params;
    const image = await getTrackedAppById(parseInt(id, 10), userId);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: "Tracked app not found",
      });
    }

    return res.json({
      success: true,
      image,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Create a new tracked app
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function createTrackedAppEndpoint(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const {
      name,
      imageName,
      githubRepo,
      sourceType,
      current_version: currentVersion,
      gitlabToken,
      repositoryTokenId,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: "Name is required",
      });
    }

    const finalSourceType = sourceType || (githubRepo ? "github" : "docker");
    let result;

    if (finalSourceType === "github") {
      if (!githubRepo || !githubRepo.trim()) {
        return res.status(400).json({
          success: false,
          error: "GitHub repository is required for GitHub source type",
        });
      }
      result = await createGitHubTrackedApp(
        userId,
        name,
        githubRepo,
        currentVersion,
        repositoryTokenId
      );
    } else if (finalSourceType === "gitlab") {
      if (!githubRepo || !githubRepo.trim()) {
        return res.status(400).json({
          success: false,
          error: "GitLab repository is required for GitLab source type",
        });
      }
      result = await createGitLabTrackedApp(
        userId,
        name,
        githubRepo,
        currentVersion,
        gitlabToken,
        repositoryTokenId
      );
    } else {
      if (!imageName || !imageName.trim()) {
        return res.status(400).json({
          success: false,
          error: "Image name is required for Docker source type",
        });
      }
      result = await createDockerTrackedApp(userId, name, imageName, currentVersion);
    }

    if (result.error) {
      return res.status(result.error.status).json({
        success: false,
        error: result.error.message,
      });
    }

    return res.json({
      success: true,
      message: result.message,
      id: result.id,
    });
  } catch (error) {
    if (error.message.includes("UNIQUE constraint failed")) {
      return res.status(400).json({
        success: false,
        error: "This item is already being tracked",
      });
    }
    next(error);
  }
}

/**
 * Update a tracked app
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Complex tracked app update logic
async function updateTrackedAppEndpoint(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const { id } = req.params;

    const {
      name,
      imageName,
      current_version: currentVersion,
      gitlabToken,
      repositoryTokenId,
      isUpgrade,
    } = req.body;

    // Check if tracked app exists
    const existing = await getTrackedAppById(parseInt(id, 10), userId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: "Tracked app not found",
      });
    }

    // Validate input - allow currentVersion updates even if name/imageName not provided
    if (!name && !imageName && currentVersion === undefined) {
      return res.status(400).json({
        success: false,
        error: "At least one field (name, imageName, or current_version) must be provided",
      });
    }

    // Check if new imageName conflicts with existing
    if (imageName && imageName !== null) {
      const trimmedImageName = String(imageName).trim();
      if (trimmedImageName !== existing.image_name) {
        const conflict = await getTrackedAppByImageName(userId, trimmedImageName);
        if (conflict && conflict.id !== parseInt(id, 10)) {
          return res.status(400).json({
            success: false,
            error: "An image with this name is already being tracked",
          });
        }
      }
    }

    // Update tracked app
    const updateData = {};
    if (name !== undefined && name !== null) {
      updateData.name = String(name).trim();
    }
    if (imageName !== undefined && imageName !== null) {
      updateData.image_name = String(imageName).trim();
    }
    if (gitlabToken !== undefined) {
      // Allow setting to null/empty string to clear token
      updateData.gitlab_token = gitlabToken && gitlabToken.trim() ? gitlabToken.trim() : null;
    }
    if (repositoryTokenId !== undefined) {
      updateData.repository_token_id = repositoryTokenId || null;
    }
    if (currentVersion !== undefined && currentVersion !== null) {
      const trimmedVersion = String(currentVersion).trim();
      updateData.current_version = trimmedVersion;
      // If updating current_version to match latest_version, also update has_update flag
      // Normalize versions for comparison (remove "v" prefix) to handle cases like "v0.107.69" vs "0.107.69"
      const normalizeVersion = (v) => {
        if (!v) {
          return "";
        }
        return String(v).replace(/^v/i, "").trim().toLowerCase();
      };

      // Check if this is an edit (imageName changed) vs an upgrade (marking as upgraded)
      const isImageNameChange =
        imageName && imageName !== null && String(imageName).trim() !== existing.image_name;
      const isExplicitUpgrade = isUpgrade === true;

      const isCurrentVersionChange = trimmedVersion !== existing.current_version;

      if (isImageNameChange || !isExplicitUpgrade) {
        // When editing (changing imageName or current_version via modal), don't clear has_update
        // Let the recheck determine if there's an update available
        // Clear current_digest to force a fresh check with the new image/version
        if (isImageNameChange) {
          updateData.current_digest = null;
        }

        // If current_version changed, clear latest_version and latest_digest to force fresh recheck
        // This ensures the recheck will fetch the latest version and compare it properly
        if (isCurrentVersionChange) {
          updateData.latest_version = null;
          updateData.latest_digest = null;
          updateData.current_digest = null; // Also clear current_digest for fresh comparison
        }

        // Don't set has_update here - let the recheck determine if there's an update
      } else {
        // When user explicitly upgrades (marks as upgraded via checkmark), set current_version AND sync latest_version to match
        // This ensures they stay in sync and batch checks won't re-detect an update
        // ALWAYS clear has_update when user explicitly upgrades
        updateData.has_update = 0;

        // If there's a stored latest_version, check if we should sync it

        if (existing.latest_version) {
          const normalizedCurrent = normalizeVersion(trimmedVersion);
          const normalizedLatest = normalizeVersion(existing.latest_version);
          const versionsMatch = normalizedCurrent === normalizedLatest && normalizedCurrent !== "";

          if (versionsMatch) {
            // Versions match after normalization - sync latest_version to current_version format
            // This ensures they're in perfect sync and batch checks won't re-detect updates
            updateData.latest_version = trimmedVersion;

            // If we have a latest_version_publish_date, use it as current_version_publish_date
            // since current and latest are now the same
            if (existing.latest_version_publish_date) {
              updateData.current_version_publish_date = existing.latest_version_publish_date;
            }
            // Clear latest_version_publish_date since current and latest are now the same
            updateData.latest_version_publish_date = null;
          } else {
            // Versions don't match after normalization - user might be upgrading to a different version
            // Still sync latest_version to current_version to keep them in sync
            updateData.latest_version = trimmedVersion;
          }
        } else {
          // No latest_version stored - set it to match current_version
          updateData.latest_version = trimmedVersion;
        }
      }
    }

    await updateTrackedApp(parseInt(id, 10), userId, updateData);

    // Fetch the updated image to return current state
    const updatedImage = await getTrackedAppById(parseInt(id, 10), userId);

    return res.json({
      success: true,
      message: "Tracked app updated successfully",

      image: updatedImage
        ? {
            ...updatedImage,
            has_update: Boolean(updatedImage.has_update),
          }
        : null,
    });
  } catch (error) {
    // Handle unique constraint violation
    if (error.message.includes("UNIQUE constraint failed")) {
      return res.status(400).json({
        success: false,
        error: "An image with this name is already being tracked",
      });
    }
    next(error);
  }
}

/**
 * Delete a tracked app
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function deleteTrackedAppEndpoint(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const { id } = req.params;

    // Check if tracked app exists
    const existing = await getTrackedAppById(parseInt(id, 10), userId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: "Tracked app not found",
      });
    }

    // Delete tracked app
    await deleteTrackedApp(parseInt(id, 10), userId);

    return res.json({
      success: true,
      message: "Tracked app deleted successfully",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Check for updates on all tracked apps
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function checkTrackedAppsUpdates(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const images = await getAllTrackedApps(userId);
    const results = await trackedAppService.checkAllTrackedApps(images);

    return res.json({
      success: true,
      results,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Check for updates on a single tracked app
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function checkTrackedAppUpdate(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const { id } = req.params;
    const image = await getTrackedAppById(parseInt(id, 10), userId);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: "Tracked app not found",
      });
    }

    const result = await trackedAppService.checkTrackedApp(image);

    return res.json({
      success: true,
      result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Clear latest version data for all tracked apps
 * This clears the latest_version, latest_digest, has_update, and current_version_publish_date
 * Also clears the GitHub and GitLab release caches
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function clearGitHubCache(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    // Clear latest version data for all tracked apps
    const rowsUpdated = await clearLatestVersionsForAllTrackedApps(userId);

    // Also clear the GitHub and GitLab release caches
    githubService.clearReleaseCache();
    gitlabService.clearReleaseCache();

    return res.json({
      success: true,
      message: `Cleared latest version data for ${rowsUpdated} tracked app(s)`,
      rowsUpdated,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getTrackedApps,
  getTrackedApp,
  createTrackedApp: createTrackedAppEndpoint,
  updateTrackedApp: updateTrackedAppEndpoint,
  deleteTrackedApp: deleteTrackedAppEndpoint,
  checkTrackedAppsUpdates,
  checkTrackedAppUpdate,
  clearGitHubCache,
};

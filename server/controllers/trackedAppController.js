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
} = require("../db/database");
const { validateRequiredFields } = require("../utils/validation");
const trackedAppService = require("../services/trackedAppService");
const githubService = require("../services/githubService");
const gitlabService = require("../services/gitlabService");
const { clearLatestVersionsForAllTrackedApps } = require("../db/database");

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
    const formattedImages = images.map((image) => {
      const latestVersion = image.latest_version ? String(image.latest_version) : null;
      const currentVersionPublishDate = image.current_version_publish_date || null;
      const latestVersionPublishDate = image.latest_version_publish_date || null;

      // For GitHub and GitLab repos, ensure we have publish date for latest version when it's different from current
      // This ensures we can show the release date for the latest version
      if ((image.source_type === "github" || image.source_type === "gitlab") && latestVersion) {
        // Normalize versions for comparison (remove "v" prefix)
        const normalizeVersion = (v) => (v ? v.replace(/^v/, "") : "");
        const normalizedCurrent = normalizeVersion(image.current_version || "");
        const normalizedLatest = normalizeVersion(latestVersion);

        // If latest version is different from current and has no publish date, we should still show it
        // but we need to make sure we have the publish date stored
        // The issue is that latest_version_publish_date should be set when there's an update
        if (normalizedCurrent !== normalizedLatest && !latestVersionPublishDate) {
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
        currentVersionPublishDate: currentVersionPublishDate,
        latestVersionPublishDate: latestVersionPublishDate,
      };
    });
    res.json({
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
    const image = await getTrackedAppById(parseInt(id), userId);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: "Tracked app not found",
      });
    }

    res.json({
      success: true,
      image: image,
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
    const { name, imageName, githubRepo, sourceType, current_version, gitlabToken, repositoryTokenId } = req.body;

    // Validate name is required
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: "Name is required",
      });
    }

    // Determine source type
    const finalSourceType = sourceType || (githubRepo ? "github" : "docker");

    if (finalSourceType === "github") {
      // Validate GitHub repo
      if (!githubRepo || !githubRepo.trim()) {
        return res.status(400).json({
          success: false,
          error: "GitHub repository is required for GitHub source type",
        });
      }

      // Check if repo already exists
      const existing = await getTrackedAppByImageName(userId, null, githubRepo.trim());
      if (existing) {
        return res.status(400).json({
          success: false,
          error: "This GitHub repository is already being tracked",
        });
      }

      // Create tracked GitHub repo
      const id = await createTrackedApp(
        userId,
        name.trim(),
        null,
        githubRepo.trim(),
        "github",
        null,
        repositoryTokenId || null
      );

      // Update current_version if provided
      if (current_version && current_version.trim()) {
        await updateTrackedApp(id, userId, { current_version: current_version.trim() });
      }

      res.json({
        success: true,
        message: "GitHub repository tracked successfully",
        id: id,
      });
    } else if (finalSourceType === "gitlab") {
      // Validate GitLab repo
      if (!githubRepo || !githubRepo.trim()) {
        return res.status(400).json({
          success: false,
          error: "GitLab repository is required for GitLab source type",
        });
      }

      // Check if repo already exists
      const existing = await getTrackedAppByImageName(userId, null, githubRepo.trim());
      if (existing) {
        return res.status(400).json({
          success: false,
          error: "This GitLab repository is already being tracked",
        });
      }

      // Create tracked GitLab repo
      const id = await createTrackedApp(
        userId,
        name.trim(),
        null,
        githubRepo.trim(),
        "gitlab",
        gitlabToken || null,
        repositoryTokenId || null
      );

      // Update current_version if provided
      if (current_version && current_version.trim()) {
        await updateTrackedApp(id, userId, { current_version: current_version.trim() });
      }

      res.json({
        success: true,
        message: "GitLab repository tracked successfully",
        id: id,
      });
    } else {
      // Docker image
      if (!imageName || !imageName.trim()) {
        return res.status(400).json({
          success: false,
          error: "Image name is required for Docker source type",
        });
      }

      // Check if image name already exists
      const existing = await getTrackedAppByImageName(userId, imageName.trim());
      if (existing) {
        return res.status(400).json({
          success: false,
          error: "An image with this name is already being tracked",
        });
      }

      // Create tracked app
      const id = await createTrackedApp(userId, name.trim(), imageName.trim(), null, "docker");

      // Update current_version if provided
      if (current_version && current_version.trim()) {
        await updateTrackedApp(id, userId, { current_version: current_version.trim() });
      }

      res.json({
        success: true,
        message: "Tracked app created successfully",
        id: id,
      });
    }
  } catch (error) {
    // Handle unique constraint violation
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
    const { name, imageName, current_version, gitlabToken, repositoryTokenId } = req.body;

    // Check if tracked app exists
    const existing = await getTrackedAppById(parseInt(id), userId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: "Tracked app not found",
      });
    }

    // Validate input - allow current_version updates even if name/imageName not provided
    if (!name && !imageName && current_version === undefined) {
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
        if (conflict && conflict.id !== parseInt(id)) {
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
    if (current_version !== undefined && current_version !== null) {
      const trimmedVersion = String(current_version).trim();
      updateData.current_version = trimmedVersion;
      // If updating current_version to match latest_version, also update has_update flag
      // Normalize versions for comparison (remove "v" prefix) to handle cases like "v0.107.69" vs "0.107.69"
      const normalizeVersion = (v) => {
        if (!v) {
          return "";
        }
        return String(v).replace(/^v/i, "").trim().toLowerCase();
      };

      // When user upgrades, set current_version AND sync latest_version to match
      // This ensures they stay in sync and batch checks won't re-detect an update
      // ALWAYS clear has_update when user explicitly upgrades
      updateData.has_update = 0;

      // If there's a stored latest_version, check if we should sync it
      if (existing.latest_version) {
        const normalizedCurrent = normalizeVersion(trimmedVersion);
        const normalizedLatest = normalizeVersion(existing.latest_version);

        if (normalizedCurrent === normalizedLatest && normalizedCurrent !== "") {
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

    await updateTrackedApp(parseInt(id), userId, updateData);

    // Fetch the updated image to return current state
    const updatedImage = await getTrackedAppById(parseInt(id), userId);

    res.json({
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
    const existing = await getTrackedAppById(parseInt(id), userId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: "Tracked app not found",
      });
    }

    // Delete tracked app
    await deleteTrackedApp(parseInt(id), userId);

    res.json({
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

    res.json({
      success: true,
      results: results,
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
    const image = await getTrackedAppById(parseInt(id), userId);

    if (!image) {
      return res.status(404).json({
        success: false,
        error: "Tracked app not found",
      });
    }

    const result = await trackedAppService.checkTrackedApp(image);

    res.json({
      success: true,
      result: result,
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

    res.json({
      success: true,
      message: `Cleared latest version data for ${rowsUpdated} tracked app(s)`,
      rowsUpdated: rowsUpdated,
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

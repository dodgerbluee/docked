/**
 * Tracked Images Controller
 * Handles CRUD operations for tracked images
 * Uses: Repositories, ApiResponse, Typed errors, Validation
 */

const container = require('../di/container');
const trackedImageService = require('../services/trackedImageService');
const githubService = require('../services/githubService');
const gitlabService = require('../services/gitlabService');
const { sendSuccess, sendCreated, sendNoContent } = require('../utils/responseHelper');
const { NotFoundError, ValidationError, ConflictError } = require('../domain/errors');

// Resolve dependencies from container
const trackedImageRepository = container.resolve('trackedImageRepository');

/**
 * Get all tracked images
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getTrackedImages(req, res, next) {
  try {
    const images = await trackedImageRepository.findAll();
    // Ensure proper data types - convert has_update from integer to boolean
    // and ensure version strings are properly formatted
    const formattedImages = images.map((image) => {
      let latestVersion = image.latest_version ? String(image.latest_version) : null;
      let currentVersionPublishDate = image.current_version_publish_date || null;
      let latestVersionPublishDate = image.latest_version_publish_date || null;

      // For GitHub and GitLab repos, ensure we have publish date for latest version when it's different from current
      if ((image.source_type === 'github' || image.source_type === 'gitlab') && latestVersion) {
        const normalizeVersion = (v) => v ? v.replace(/^v/, '') : '';
        const normalizedCurrent = normalizeVersion(image.current_version || '');
        const normalizedLatest = normalizeVersion(latestVersion);
        
        if (normalizedCurrent !== normalizedLatest && !latestVersionPublishDate) {
          // Publish date will be "Not available" if not set
        }
      }

      return {
        ...image,
        has_update: Boolean(image.has_update),
        current_version: image.current_version ? String(image.current_version) : null,
        latest_version: latestVersion,
        source_type: image.source_type || 'docker',
        github_repo: image.github_repo || null,
        gitlab_token: image.gitlab_token || null,
        currentVersionPublishDate: currentVersionPublishDate,
        latestVersionPublishDate: latestVersionPublishDate,
      };
    });
    sendSuccess(res, { images: formattedImages });
  } catch (error) {
    next(error);
  }
}

/**
 * Get a single tracked image
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getTrackedImage(req, res, next) {
  try {
    const { id } = req.params;
    const image = await trackedImageRepository.findById(parseInt(id));
    
    if (!image) {
      throw new NotFoundError('Tracked image');
    }

    sendSuccess(res, { image });
  } catch (error) {
    next(error);
  }
}

/**
 * Create a new tracked image
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function createTrackedImageEndpoint(req, res, next) {
  try {
    const { name, imageName, githubRepo, sourceType, current_version, gitlabToken } = req.body;

    // Validate name is required
    if (!name || !name.trim()) {
      throw new ValidationError('Name is required', 'name');
    }

    // Determine source type
    const finalSourceType = sourceType || (githubRepo ? "github" : "docker");

    if (finalSourceType === 'github') {
      // Validate GitHub repo
      if (!githubRepo || !githubRepo.trim()) {
        throw new ValidationError('GitHub repository is required for GitHub source type', 'githubRepo');
      }

      // Check if repo already exists
      const existing = await trackedImageRepository.findByImageNameOrRepo(null, githubRepo.trim());
      if (existing) {
        throw new ConflictError('This GitHub repository is already being tracked');
      }

      // Create tracked GitHub repo
      const id = await trackedImageRepository.create({
        name: name.trim(),
        imageName: null,
        githubRepo: githubRepo.trim(),
        sourceType: 'github',
      });
      
      // Update current_version if provided
      if (current_version && current_version.trim()) {
        await trackedImageRepository.update(id, { current_version: current_version.trim() });
      }
      
      sendCreated(res, {
        message: 'GitHub repository tracked successfully',
        id: id,
      });
    } else if (finalSourceType === "gitlab") {
      // Validate GitLab repo
      if (!githubRepo || !githubRepo.trim()) {
        throw new ValidationError('GitLab repository is required for GitLab source type', 'githubRepo');
      }

      // Check if repo already exists
      const existing = await trackedImageRepository.findByImageNameOrRepo(null, githubRepo.trim());
      if (existing) {
        throw new ConflictError('This GitLab repository is already being tracked');
      }

      // Create tracked GitLab repo
      const id = await trackedImageRepository.create({
        name: name.trim(),
        imageName: null,
        githubRepo: githubRepo.trim(),
        sourceType: 'gitlab',
        gitlabToken: gitlabToken || null,
      });
      
      // Update current_version if provided
      if (current_version && current_version.trim()) {
        await trackedImageRepository.update(id, { current_version: current_version.trim() });
      }
      
      sendCreated(res, {
        message: 'GitLab repository tracked successfully',
        id: id,
      });
    } else {
      // Docker image
      if (!imageName || !imageName.trim()) {
        throw new ValidationError('Image name is required for Docker source type', 'imageName');
      }

      // Check if image name already exists
      const existing = await trackedImageRepository.findByImageNameOrRepo(imageName.trim());
      if (existing) {
        throw new ConflictError('An image with this name is already being tracked');
      }

      // Create tracked image
      const id = await trackedImageRepository.create({
        name: name.trim(),
        imageName: imageName.trim(),
        githubRepo: null,
        sourceType: 'docker',
      });
      
      // Update current_version if provided
      if (current_version && current_version.trim()) {
        await trackedImageRepository.update(id, { current_version: current_version.trim() });
      }
      
      sendCreated(res, {
        message: 'Tracked image created successfully',
        id: id,
      });
    }
  } catch (error) {
    // Handle unique constraint violation
    if (error.message && error.message.includes('UNIQUE constraint failed')) {
      throw new ConflictError('This item is already being tracked');
    }
    next(error);
  }
}

/**
 * Update a tracked image
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function updateTrackedImageEndpoint(req, res, next) {
  try {
    const { id } = req.params;
    const { name, imageName, current_version, gitlabToken } = req.body;

    // Check if tracked image exists
    const existing = await trackedImageRepository.findById(parseInt(id));
    if (!existing) {
      throw new NotFoundError('Tracked image');
    }

    // Validate input - allow current_version updates even if name/imageName not provided
    if (!name && !imageName && current_version === undefined) {
      throw new ValidationError('At least one field (name, imageName, or current_version) must be provided');
    }

    // Check if new imageName conflicts with existing
    if (imageName && imageName !== null) {
      const trimmedImageName = String(imageName).trim();
      if (trimmedImageName !== existing.image_name) {
        const conflict = await trackedImageRepository.findByImageNameOrRepo(trimmedImageName);
        if (conflict && conflict.id !== parseInt(id)) {
          throw new ConflictError('An image with this name is already being tracked');
        }
      }
    }

    // Update tracked image
    const updateData = {};
    if (name !== undefined && name !== null) updateData.name = String(name).trim();
    if (imageName !== undefined && imageName !== null)
      updateData.image_name = String(imageName).trim();
    if (gitlabToken !== undefined) {
      // Allow setting to null/empty string to clear token
      updateData.gitlab_token = gitlabToken && gitlabToken.trim() ? gitlabToken.trim() : null;
    }
    if (current_version !== undefined && current_version !== null) {
      const trimmedVersion = String(current_version).trim();
      updateData.current_version = trimmedVersion;
      // If updating current_version to match latest_version, also update has_update flag
      // Normalize versions for comparison (remove "v" prefix) to handle cases like "v0.107.69" vs "0.107.69"
      const normalizeVersion = (v) => {
        if (!v) return "";
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

    await trackedImageRepository.update(parseInt(id), updateData);

    // Fetch the updated image to return current state
    const updatedImage = await trackedImageRepository.findById(parseInt(id));

    sendSuccess(res, {
      message: 'Tracked image updated successfully',
      image: updatedImage ? {
        ...updatedImage,
        has_update: Boolean(updatedImage.has_update),
      } : null,
    });
  } catch (error) {
    // Handle unique constraint violation
    if (error.message && error.message.includes('UNIQUE constraint failed')) {
      throw new ConflictError('An image with this name is already being tracked');
    }
    next(error);
  }
}

/**
 * Delete a tracked image
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function deleteTrackedImageEndpoint(req, res, next) {
  try {
    const { id } = req.params;

    // Check if tracked image exists
    const existing = await trackedImageRepository.findById(parseInt(id));
    if (!existing) {
      throw new NotFoundError('Tracked image');
    }

    // Delete tracked image
    await trackedImageRepository.delete(parseInt(id));

    sendSuccess(res, { message: 'Tracked image deleted successfully' });
  } catch (error) {
    next(error);
  }
}

/**
 * Check for updates on all tracked images
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function checkTrackedImagesUpdates(req, res, next) {
  try {
    const images = await trackedImageRepository.findAll();
    const results = await trackedImageService.checkAllTrackedImages(images);
    
    sendSuccess(res, { results });
  } catch (error) {
    next(error);
  }
}

/**
 * Check for updates on a single tracked image
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function checkTrackedImageUpdate(req, res, next) {
  try {
    const { id } = req.params;
    const image = await trackedImageRepository.findById(parseInt(id));
    
    if (!image) {
      throw new NotFoundError('Tracked image');
    }

    const result = await trackedImageService.checkTrackedImage(image);
    
    sendSuccess(res, { result });
  } catch (error) {
    next(error);
  }
}

/**
 * Clear latest version data for all tracked images
 * This clears the latest_version, latest_digest, has_update, and current_version_publish_date
 * Also clears the GitHub and GitLab release caches
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function clearGitHubCache(req, res, next) {
  try {
    // Clear latest version data for all tracked images
    const rowsUpdated = await trackedImageRepository.clearLatestVersions();
    
    // Also clear the GitHub and GitLab release caches
    githubService.clearReleaseCache();
    gitlabService.clearReleaseCache();
    
    sendSuccess(res, {
      message: `Cleared latest version data for ${rowsUpdated} tracked app(s)`,
      rowsUpdated: rowsUpdated,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getTrackedImages,
  getTrackedImage,
  createTrackedImage: createTrackedImageEndpoint,
  updateTrackedImage: updateTrackedImageEndpoint,
  deleteTrackedImage: deleteTrackedImageEndpoint,
  checkTrackedImagesUpdates,
  checkTrackedImageUpdate,
  clearGitHubCache,
};

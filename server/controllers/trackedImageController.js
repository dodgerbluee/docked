/**
 * Tracked Images Controller
 * Handles CRUD operations for tracked images
 */

const {
  getAllTrackedImages,
  getTrackedImageById,
  getTrackedImageByImageName,
  createTrackedImage,
  updateTrackedImage,
  deleteTrackedImage,
} = require('../db/database');
const { validateRequiredFields } = require('../utils/validation');
const trackedImageService = require('../services/trackedImageService');
const githubService = require('../services/githubService');
const { clearLatestVersionsForAllTrackedImages } = require('../db/database');

/**
 * Get all tracked images
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getTrackedImages(req, res, next) {
  try {
    const images = await getAllTrackedImages();
    // Ensure proper data types - convert has_update from integer to boolean
    // and ensure version strings are properly formatted
    const formattedImages = images.map(image => {
      let latestVersion = image.latest_version ? String(image.latest_version) : null;
      let currentVersionPublishDate = image.current_version_publish_date || null;
      let latestVersionPublishDate = image.latest_version_publish_date || null;
      
      // For GitHub repos, ensure we have publish date for latest version when it's different from current
      // This ensures we can show the release date for the latest version
      if (image.source_type === 'github' && latestVersion) {
        // Normalize versions for comparison (remove "v" prefix)
        const normalizeVersion = (v) => v ? v.replace(/^v/, '') : '';
        const normalizedCurrent = normalizeVersion(image.current_version || '');
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
        source_type: image.source_type || 'docker', // Default to 'docker' for existing records
        github_repo: image.github_repo || null,
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
 * Get a single tracked image
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getTrackedImage(req, res, next) {
  try {
    const { id } = req.params;
    const image = await getTrackedImageById(parseInt(id));
    
    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'Tracked image not found',
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
 * Create a new tracked image
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function createTrackedImageEndpoint(req, res, next) {
  try {
    const { name, imageName, githubRepo, sourceType, current_version } = req.body;

    // Validate name is required
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Name is required',
      });
    }

    // Determine source type
    const finalSourceType = sourceType || (githubRepo ? 'github' : 'docker');

    if (finalSourceType === 'github') {
      // Validate GitHub repo
      if (!githubRepo || !githubRepo.trim()) {
        return res.status(400).json({
          success: false,
          error: 'GitHub repository is required for GitHub source type',
        });
      }

      // Check if repo already exists
      const existing = await getTrackedImageByImageName(null, githubRepo.trim());
      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'This GitHub repository is already being tracked',
        });
      }

      // Create tracked GitHub repo
      const id = await createTrackedImage(name.trim(), null, githubRepo.trim(), 'github');
      
      // Update current_version if provided
      if (current_version && current_version.trim()) {
        await updateTrackedImage(id, { current_version: current_version.trim() });
      }
      
      res.json({
        success: true,
        message: 'GitHub repository tracked successfully',
        id: id,
      });
    } else {
      // Docker image
      if (!imageName || !imageName.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Image name is required for Docker source type',
        });
      }

      // Check if image name already exists
      const existing = await getTrackedImageByImageName(imageName.trim());
      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'An image with this name is already being tracked',
        });
      }

      // Create tracked image
      const id = await createTrackedImage(name.trim(), imageName.trim(), null, 'docker');
      
      // Update current_version if provided
      if (current_version && current_version.trim()) {
        await updateTrackedImage(id, { current_version: current_version.trim() });
      }
      
      res.json({
        success: true,
        message: 'Tracked image created successfully',
        id: id,
      });
    }
  } catch (error) {
    // Handle unique constraint violation
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({
        success: false,
        error: 'This item is already being tracked',
      });
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
    const { name, imageName, current_version } = req.body;

    // Check if tracked image exists
    const existing = await getTrackedImageById(parseInt(id));
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Tracked image not found',
      });
    }

    // Validate input - allow current_version updates even if name/imageName not provided
    if (!name && !imageName && current_version === undefined) {
      return res.status(400).json({
        success: false,
        error: 'At least one field (name, imageName, or current_version) must be provided',
      });
    }

    // Check if new imageName conflicts with existing
    if (imageName && imageName !== null) {
      const trimmedImageName = String(imageName).trim();
      if (trimmedImageName !== existing.image_name) {
        const conflict = await getTrackedImageByImageName(trimmedImageName);
        if (conflict && conflict.id !== parseInt(id)) {
          return res.status(400).json({
            success: false,
            error: 'An image with this name is already being tracked',
          });
        }
      }
    }

    // Update tracked image
    const updateData = {};
    if (name !== undefined && name !== null) updateData.name = String(name).trim();
    if (imageName !== undefined && imageName !== null) updateData.image_name = String(imageName).trim();
    if (current_version !== undefined && current_version !== null) {
      const trimmedVersion = String(current_version).trim();
      updateData.current_version = trimmedVersion;
      // If updating current_version to match latest_version, also update has_update flag
      // Normalize versions for comparison (remove "v" prefix) to handle cases like "v0.107.69" vs "0.107.69"
      const normalizeVersion = (v) => {
        if (!v) return '';
        return String(v).replace(/^v/i, '').trim().toLowerCase();
      };
      
      // When user upgrades, set current_version AND sync latest_version to match
      // This ensures they stay in sync and batch checks won't re-detect an update
      // ALWAYS clear has_update when user explicitly upgrades
      updateData.has_update = 0;
      
      // If there's a stored latest_version, check if we should sync it
      if (existing.latest_version) {
        const normalizedCurrent = normalizeVersion(trimmedVersion);
        const normalizedLatest = normalizeVersion(existing.latest_version);
        
        if (normalizedCurrent === normalizedLatest && normalizedCurrent !== '') {
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

    await updateTrackedImage(parseInt(id), updateData);

    // Fetch the updated image to return current state
    const updatedImage = await getTrackedImageById(parseInt(id));

    res.json({
      success: true,
      message: 'Tracked image updated successfully',
      image: updatedImage ? {
        ...updatedImage,
        has_update: Boolean(updatedImage.has_update),
      } : null,
    });
  } catch (error) {
    // Handle unique constraint violation
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({
        success: false,
        error: 'An image with this name is already being tracked',
      });
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
    const existing = await getTrackedImageById(parseInt(id));
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Tracked image not found',
      });
    }

    // Delete tracked image
    await deleteTrackedImage(parseInt(id));

    res.json({
      success: true,
      message: 'Tracked image deleted successfully',
    });
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
    const images = await getAllTrackedImages();
    const results = await trackedImageService.checkAllTrackedImages(images);
    
    res.json({
      success: true,
      results: results,
    });
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
    const image = await getTrackedImageById(parseInt(id));
    
    if (!image) {
      return res.status(404).json({
        success: false,
        error: 'Tracked image not found',
      });
    }

    const result = await trackedImageService.checkTrackedImage(image);
    
    res.json({
      success: true,
      result: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Clear latest version data for all tracked images
 * This clears the latest_version, latest_digest, has_update, and current_version_publish_date
 * Also clears the GitHub release cache
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function clearGitHubCache(req, res, next) {
  try {
    // Clear latest version data for all tracked images
    const rowsUpdated = await clearLatestVersionsForAllTrackedImages();
    
    // Also clear the GitHub release cache
    githubService.clearReleaseCache();
    
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
  getTrackedImages,
  getTrackedImage,
  createTrackedImage: createTrackedImageEndpoint,
  updateTrackedImage: updateTrackedImageEndpoint,
  deleteTrackedImage: deleteTrackedImageEndpoint,
  checkTrackedImagesUpdates,
  checkTrackedImageUpdate,
  clearGitHubCache,
};


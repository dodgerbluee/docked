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
    const formattedImages = images.map(image => ({
      ...image,
      has_update: Boolean(image.has_update), // Convert 0/1 to boolean
      current_version: image.current_version ? String(image.current_version) : null,
      latest_version: image.latest_version ? String(image.latest_version) : null,
      source_type: image.source_type || 'docker', // Default to 'docker' for existing records
      github_repo: image.github_repo || null,
      currentVersionPublishDate: image.current_version_publish_date || null,
    }));
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
    if (imageName && imageName.trim() !== existing.image_name) {
      const conflict = await getTrackedImageByImageName(imageName.trim());
      if (conflict && conflict.id !== parseInt(id)) {
        return res.status(400).json({
          success: false,
          error: 'An image with this name is already being tracked',
        });
      }
    }

    // Update tracked image
    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (imageName !== undefined) updateData.image_name = imageName.trim();
    if (current_version !== undefined) {
      updateData.current_version = current_version.trim();
      // If updating current_version to match latest_version, also update has_update flag
      if (existing.latest_version && current_version.trim() === existing.latest_version) {
        updateData.has_update = 0;
      }
    }

    await updateTrackedImage(parseInt(id), updateData);

    res.json({
      success: true,
      message: 'Tracked image updated successfully',
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

module.exports = {
  getTrackedImages,
  getTrackedImage,
  createTrackedImage: createTrackedImageEndpoint,
  updateTrackedImage: updateTrackedImageEndpoint,
  deleteTrackedImage: deleteTrackedImageEndpoint,
  checkTrackedImagesUpdates,
  checkTrackedImageUpdate,
};


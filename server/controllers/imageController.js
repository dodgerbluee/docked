/**
 * Image Controller
 * Handles HTTP requests for image operations
 * Uses: Repositories, ApiResponse, Typed errors, Validation
 */

const container = require('../di/container');
const containerService = require("../services/containerService");
const portainerService = require("../services/portainerService");
const { sendSuccess } = require('../utils/responseHelper');
const { ValidationError } = require('../domain/errors');
const logger = require("../utils/logger");

// Resolve dependencies from container
const portainerInstanceRepository = container.resolve('portainerInstanceRepository');

/**
 * Get unused images
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getUnusedImages(req, res, next) {
  try {
    const unusedImages = await containerService.getUnusedImages();
    sendSuccess(res, { unusedImages });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete selected images
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function deleteImages(req, res, next) {
  try {
    const { images } = req.body;

    // Validate input - validateImageArray throws ValidationError
    const { validateImageArray } = require("../utils/validation");
    validateImageArray(images);

    const results = [];
    const errors = [];

    // Deduplicate images by id+portainerUrl+endpointId
    const uniqueImages = [];
    const seenKeys = new Set();
    for (const image of images) {
      const key = `${image.id}-${image.portainerUrl}-${image.endpointId}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueImages.push(image);
      }
    }

    logger.info(
      `Received ${images.length} images, deduplicated to ${uniqueImages.length} unique images`
    );

    // Get all instances once to avoid repeated DB queries
    const instances = await portainerInstanceRepository.findAll();
    const instanceMap = new Map(instances.map((inst) => [inst.url, inst]));

    // Delete images
    for (const image of uniqueImages) {
      const { id, portainerUrl, endpointId } = image;
      try {
        const instance = instanceMap.get(portainerUrl);
        if (!instance) {
          errors.push({
            id,
            error: `Portainer instance not found: ${portainerUrl}`,
          });
          continue;
        }

        await portainerService.authenticatePortainer(
          portainerUrl,
          instance.username,
          instance.password,
          instance.api_key,
          instance.auth_type || "apikey"
        );
        logger.info(
          `Deleting image ${id.substring(0, 12)} from ${portainerUrl}`
        );
        await portainerService.deleteImage(portainerUrl, endpointId, id, true);
        results.push({ id, success: true });
      } catch (error) {
        logger.error(
          `Failed to delete image ${id.substring(0, 12)}:`,
          error.message
        );
        errors.push({ id, error: error.message });
      }
    }

    sendSuccess(res, {
      deleted: results.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getUnusedImages,
  deleteImages,
};

/**
 * Image Controller
 * Handles HTTP requests for image operations
 */

const containerService = require("../services/containerService");
const portainerService = require("../services/portainerService");
const { validateImageArray } = require("../utils/validation");
const { getAllPortainerInstances } = require("../db/index");
const logger = require("../utils/logger");

/**
 * Get unused images
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getUnusedImages(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const unusedImages = await containerService.getUnusedImages(userId);
    return res.json({ unusedImages });
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
// eslint-disable-next-line max-lines-per-function -- Complex image deletion logic
async function deleteImages(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const { images } = req.body;

    // Validate input
    const validationError = validateImageArray(images);
    if (validationError) {
      return res.status(400).json(validationError);
    }

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
      `Received ${images.length} images, deduplicated to ${uniqueImages.length} unique images`,
    );

    // Get user's instances once to avoid repeated DB queries
    const instances = await getAllPortainerInstances(userId);
    const instanceMap = new Map(instances.map(inst => [inst.url, inst]));

    // Delete images in parallel
    const deletePromises = uniqueImages.map(async image => {
      const { id, portainerUrl, endpointId } = image;
      try {
        const instance = instanceMap.get(portainerUrl);
        if (!instance) {
          return {
            id,
            error: `Portainer instance not found: ${portainerUrl}`,
          };
        }


        await portainerService.authenticatePortainer({
          portainerUrl,
          username: instance.username,
          password: instance.password,
          apiKey: instance.api_key,
          authType: instance.auth_type || "apikey",
        });
        logger.info(`Deleting image ${id.substring(0, 12)} from ${portainerUrl}`);

        await portainerService.deleteImage(portainerUrl, endpointId, id, true);
        logger.info(`Successfully deleted image ${id.substring(0, 12)} from ${portainerUrl}`);
        return { id, success: true };
      } catch (error) {
        logger.error(`Failed to delete image ${id.substring(0, 12)}:`, { error });
        return { id, error: error.message };
      }
    });

    const deleteResults = await Promise.allSettled(deletePromises);
    deleteResults.forEach(result => {
      if (result.status === "fulfilled") {
        if (result.value.success) {
          results.push(result.value);
        } else {
          errors.push(result.value);
        }
      } else {
        errors.push({ id: "unknown", error: result.reason?.message || "Unknown error" });
      }
    });

    return res.json({
      success: true,
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

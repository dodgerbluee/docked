/**
 * Image Controller
 * Handles HTTP requests for image operations
 */

const containerService = require("../services/containerService");
const portainerService = require("../services/portainerService");
const runnerDockerService = require("../services/runnerDockerService");
const { validateImageArray } = require("../utils/validation");
const { getAllSourceInstances } = require("../db/index");
const { getAllRunners } = require("../db/runners");
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

    // Deduplicate images by id+source+endpointId
    const uniqueImages = [];
    const seenKeys = new Set();
    for (const image of images) {
      const source = image.runnerId ?? image.portainerUrl ?? image.sourceUrl;
      const key = `${image.id}-${source}-${image.endpointId}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueImages.push(image);
      }
    }

    logger.info(
      `Received ${images.length} images, deduplicated to ${uniqueImages.length} unique images`
    );

    // Get user's instances and runners once to avoid repeated DB queries
    const [instances, runners] = await Promise.all([
      getAllSourceInstances(userId),
      getAllRunners(userId),
    ]);
    const instanceMap = new Map(instances.map((inst) => [inst.url, inst]));
    const runnerMap = new Map(runners.map((r) => [r.id, r]));

    // Delete images in parallel
    const deletePromises = uniqueImages.map(async (image) => {
      const { id, portainerUrl, endpointId, runnerId, sourceUrl } = image;
      const shortId = (id || "").substring(0, 12);
      try {
        // Runner image: use runner API
        if (runnerId) {
          const runner = runnerMap.get(runnerId);
          if (!runner) {
            return { id, error: `Runner not found: ${runnerId}` };
          }
          logger.info(`Deleting image ${shortId} from runner ${runner.name || runner.url}`);
          await runnerDockerService.deleteImage(runner.url, null, id, true, runner.api_key);
          logger.info(
            `Successfully deleted image ${shortId} from runner ${runner.name || runner.url}`
          );
          return { id, success: true };
        }

        // Portainer image: use Portainer API
        const resolvedUrl = portainerUrl || sourceUrl;
        const instance = instanceMap.get(resolvedUrl);
        if (!instance) {
          return {
            id,
            error: `Portainer instance not found: ${resolvedUrl}`,
          };
        }

        await portainerService.authenticatePortainer({
          portainerUrl: resolvedUrl,
          username: instance.username,
          password: instance.password,
          apiKey: instance.api_key,
          authType: instance.auth_type || "apikey",
        });
        logger.info(`Deleting image ${shortId} from ${resolvedUrl}`);

        await portainerService.deleteImage(resolvedUrl, endpointId, id, true);
        logger.info(`Successfully deleted image ${shortId} from ${resolvedUrl}`);
        return { id, success: true };
      } catch (error) {
        logger.error(`Failed to delete image ${shortId}:`, { error });
        return { id, error: error.message };
      }
    });

    const deleteResults = await Promise.allSettled(deletePromises);
    deleteResults.forEach((result) => {
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

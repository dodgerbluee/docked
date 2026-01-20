/**
 * Container Debug Controller
 * Provides debugging information about containers and related database records
 */

const logger = require("../utils/logger");
const { getDatabase } = require("../db/connection");

/**
 * Get complete debug information for a container
 * Includes all related database records from:
 * - containers table
 * - deployed_images table
 * - registry_image_versions table
 * - upgrade_history table
 */
async function getContainerDebugInfo(req, res) {
  try {
    const { containerId } = req.params;
    const userId = req.user.id;

    const db = getDatabase();

    // Get container record
    const containerRecord = await new Promise((resolve, reject) => {
      db.get(
        `SELECT c.*, pi.name as portainer_name, pi.url as portainer_url
         FROM containers c
         LEFT JOIN portainer_instances pi ON c.portainer_instance_id = pi.id
         WHERE c.container_id = ? AND c.user_id = ?`,
        [containerId, userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!containerRecord) {
      return res.status(404).json({ error: "Container not found" });
    }

    // Get deployed image record
    const deployedImageRecord = containerRecord.deployed_image_id
      ? await new Promise((resolve, reject) => {
          db.get(
            `SELECT * FROM deployed_images WHERE id = ? AND user_id = ?`,
            [containerRecord.deployed_image_id, userId],
            (err, row) => {
              if (err) reject(err);
              else resolve(row);
            }
          );
        })
      : null;

    // Get all deployed images for this image_repo and tag (to see if there are duplicates)
    const allDeployedImages = deployedImageRecord
      ? await new Promise((resolve, reject) => {
          db.all(
            `SELECT * FROM deployed_images 
             WHERE user_id = ? AND image_repo = ? AND image_tag = ?
             ORDER BY last_seen DESC`,
            [userId, deployedImageRecord.image_repo, deployedImageRecord.image_tag],
            (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            }
          );
        })
      : [];

    // Get registry image version record
    const registryImageVersion = containerRecord.image_repo
      ? await new Promise((resolve, reject) => {
          db.get(
            `SELECT * FROM registry_image_versions 
             WHERE user_id = ? AND image_repo = ?
             ORDER BY last_checked DESC
             LIMIT 1`,
            [userId, containerRecord.image_repo],
            (err, row) => {
              if (err) reject(err);
              else resolve(row);
            }
          );
        })
      : null;

    // Get all registry image versions for this image_repo (to see all tags)
    const allRegistryImageVersions = containerRecord.image_repo
      ? await new Promise((resolve, reject) => {
          db.all(
            `SELECT * FROM registry_image_versions 
             WHERE user_id = ? AND image_repo = ?
             ORDER BY last_checked DESC`,
            [userId, containerRecord.image_repo],
            (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            }
          );
        })
      : [];

    // Get upgrade history for this container
    const upgradeHistory = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM upgrade_history 
         WHERE user_id = ? AND (container_id = ? OR container_name = ?)
         ORDER BY created_at DESC
         LIMIT 20`,
        [userId, containerId, containerRecord.container_name],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Get all containers with the same name (to see if there are duplicates with different IDs)
    const allContainersWithSameName = await new Promise((resolve, reject) => {
      db.all(
        `SELECT c.*, pi.name as portainer_name, pi.url as portainer_url
         FROM containers c
         LEFT JOIN portainer_instances pi ON c.portainer_instance_id = pi.id
         WHERE c.user_id = ? AND c.container_name = ?
         ORDER BY c.last_seen DESC`,
        [userId, containerRecord.container_name],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Build response
    const debugInfo = {
      container: containerRecord,
      deployedImage: deployedImageRecord,
      allDeployedImages,
      registryImageVersion,
      allRegistryImageVersions,
      upgradeHistory,
      allContainersWithSameName,
      metadata: {
        queried_at: new Date().toISOString(),
        container_id: containerId,
        user_id: userId,
      },
    };

    logger.info("Container debug info retrieved", {
      userId,
      containerId: containerId.substring(0, 12),
      containerName: containerRecord.container_name,
    });

    res.json(debugInfo);
  } catch (error) {
    logger.error("Error fetching container debug info:", { error, userId: req.user.id });
    res.status(500).json({ error: "Failed to fetch container debug info" });
  }
}

module.exports = {
  getContainerDebugInfo,
};

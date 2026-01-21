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
    // Extract tag from image_name to ensure we get the correct registry record
    const containerImageTag = containerRecord.image_name?.includes(":")
      ? containerRecord.image_name.split(":")[1]
      : "latest";
    
    const registryImageVersion = containerRecord.image_repo
      ? await new Promise((resolve, reject) => {
          db.get(
            `SELECT * FROM registry_image_versions 
             WHERE user_id = ? AND image_repo = ? AND tag = ?
             ORDER BY last_checked DESC
             LIMIT 1`,
            [userId, containerRecord.image_repo, containerImageTag],
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

    // Get RepoDigests from deployed image (stored in database) or fetch from Portainer if not available
    let repoDigests = null;
    
    // First, try to get from database (deployed_images.repo_digests)
    if (deployedImageRecord?.repo_digests) {
      try {
        repoDigests = JSON.parse(deployedImageRecord.repo_digests);
        logger.debug(`Using stored RepoDigests for container ${containerRecord.container_name} (${repoDigests.length} digests)`);
      } catch (parseErr) {
        logger.debug(`Failed to parse stored repo_digests: ${parseErr.message}`);
      }
    }
    
    // If not in database, fetch from Portainer as fallback
    if (!repoDigests && containerRecord.portainer_url && containerRecord.endpoint_id) {
      try {
        const portainerService = require("../services/portainerService");
        
        // First, get container details to obtain the Image ID
        const containerDetails = await portainerService.getContainerDetails(
          containerRecord.portainer_url,
          containerRecord.endpoint_id,
          containerId
        );
        
        // Then fetch image details using the Image ID
        if (containerDetails?.Image) {
          const imageDetails = await portainerService.getImageDetails(
            containerRecord.portainer_url,
            containerRecord.endpoint_id,
            containerDetails.Image
          );
          
          if (imageDetails.RepoDigests && Array.isArray(imageDetails.RepoDigests)) {
            // Clean RepoDigests: remove image name prefix (e.g., "postgres@sha256:..." -> "sha256:...")
            repoDigests = imageDetails.RepoDigests.map(rd => {
              if (rd.includes('@sha256:')) {
                return 'sha256:' + rd.split('@sha256:')[1];
              }
              return rd; // Already clean
            });
            logger.debug(`Fetched ${repoDigests.length} RepoDigests from Portainer for container ${containerRecord.container_name}`);
          }
        }
      } catch (imageError) {
        logger.debug(`Could not fetch RepoDigests for container ${containerId}: ${imageError.message}`);
      }
    }

    // Build response
    const debugInfo = {
      container: containerRecord,
      deployedImage: deployedImageRecord,
      repoDigests, // All RepoDigests from Portainer (for multi-arch images)
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

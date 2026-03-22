/**
 * Container Debug Controller
 * Provides debugging information about containers and related database records
 */

const logger = require("../utils/logger");
const { getDatabase } = require("../db/connection");
const { getEnabledRunnersWithKeysByUser } = require("../db/runners");
const runnerDockerService = require("../services/runnerDockerService");

/**
 * Try to build a debug response for a runner container that isn't in the containers DB.
 * Queries each enabled runner until the container is found, then enriches with
 * registry_image_versions data if available.
 * @returns {Object|null} debug response or null if not found
 */
async function buildRunnerDebugInfo(containerId, userId, db) {
  let runners;
  try {
    runners = await getEnabledRunnersWithKeysByUser(userId);
  } catch (err) {
    logger.warn("buildRunnerDebugInfo: failed to get runners", { error: err.message });
    return null;
  }

  logger.debug("buildRunnerDebugInfo: checking runners", {
    containerId: containerId.substring(0, 12),
    runnerCount: runners.length,
  });

  for (const runner of runners) {
    // Try full-inspect first; fall back to scanning the container list
    // (older dockhand versions may not have /containers/{id}/json registered)
    let details = null;
    let repoDigests = null;
    try {
      details = await runnerDockerService.getContainerDetails(
        runner.url,
        null,
        containerId,
        runner.api_key
      );
    } catch (err) {
      logger.debug(
        `buildRunnerDebugInfo: getContainerDetails failed on "${runner.name}", trying list fallback`,
        { error: err.message, status: err.response?.status }
      );
    }

    // Always fetch the container list: dockhand pre-fetches RepoDigests from local images
    // and includes them in the list response. Also used as fallback when getContainerDetails fails.
    try {
      const allContainers = await runnerDockerService.getContainers(
        runner.url,
        null,
        runner.api_key
      );
      const match = allContainers.find((c) => (c.Id || c.id) === containerId);
      if (match) {
        // Clean repoDigests: strip image name prefix (e.g. "ghcr.io/foo@sha256:abc" → "sha256:abc")
        const raw = match.repoDigests || [];
        const cleaned = raw
          .map((rd) => (rd.includes("@sha256:") ? "sha256:" + rd.split("@sha256:")[1] : rd))
          .filter(Boolean);
        if (cleaned.length > 0) repoDigests = cleaned;

        if (!details) {
          // Synthesize a minimal details object from the list entry
          details = {
            Id: match.Id || match.id,
            Name: `/${match.Name || match.name || ""}`,
            Config: { Image: match.Image || match.image || "" },
            State: {
              Status: match.State || match.state || "",
              Running: (match.State || match.state) === "running",
            },
          };
          logger.debug(`buildRunnerDebugInfo: found container via list on runner "${runner.name}"`);
        }
      }
    } catch (listErr) {
      logger.debug(`buildRunnerDebugInfo: list fallback also failed on "${runner.name}"`, {
        error: listErr.message,
      });
    }

    if (!details) {
      logger.debug(`buildRunnerDebugInfo: container not found on runner "${runner.name}"`);
      continue;
    }
    logger.debug(`buildRunnerDebugInfo: found container on runner "${runner.name}"`);

    // Extract image repo and tag for registry lookup
    const imageName = details.Config?.Image || "";
    let imageRepo = imageName;
    let imageTag = "latest";
    const colonIdx = imageName.lastIndexOf(":");
    if (colonIdx > 0) {
      imageRepo = imageName.substring(0, colonIdx);
      imageTag = imageName.substring(colonIdx + 1);
    }

    // Look up registry_image_versions for this image
    const registryImageVersion = await new Promise((resolve) => {
      db.get(
        `SELECT * FROM registry_image_versions
         WHERE user_id = ? AND tag = ? AND (
           image_repo = ?
           OR REPLACE(COALESCE(image_repo,''),'docker.io/','') = REPLACE(COALESCE(?,''),'docker.io/','')
         )
         ORDER BY last_checked DESC LIMIT 1`,
        [userId, imageTag, imageRepo, imageRepo],
        (err, row) => resolve(err ? null : row)
      );
    });

    const upgradeHistory = await new Promise((resolve) => {
      const containerName = details.Name?.replace(/^\//, "") || "";
      db.all(
        `SELECT * FROM upgrade_history
         WHERE user_id = ? AND (container_id = ? OR container_name = ?)
         ORDER BY created_at DESC LIMIT 20`,
        [userId, containerId, containerName],
        (err, rows) => resolve(err ? [] : rows || [])
      );
    });

    // Build a synthetic container record in the same shape as the DB row
    const syntheticContainer = {
      container_id: containerId,
      container_name: details.Name?.replace(/^\//, "") || "",
      image_name: imageName,
      image_repo: imageRepo,
      runner_id: runner.id,
      runner_name: runner.name,
      portainer_name: null,
      portainer_url: null,
      source_instance_name: null,
      source_url: null,
      endpoint_id: null,
      status: details.State?.Status || "",
      state: details.State?.Running ? "running" : "stopped",
      source: "runner",
    };

    return {
      container: syntheticContainer,
      deployedImage: null,
      repoDigests,
      allDeployedImages: [],
      registryImageVersion: registryImageVersion || null,
      allRegistryImageVersions: registryImageVersion ? [registryImageVersion] : [],
      upgradeHistory,
      allContainersWithSameName: [],
      metadata: {
        queried_at: new Date().toISOString(),
        container_id: containerId,
        user_id: userId,
        source: "runner",
        runner_id: runner.id,
        runner_name: runner.name,
      },
    };
  }

  return null;
}

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
        `SELECT c.*, pi.name as source_instance_name, pi.url as source_url,
                pi.name as portainer_name, pi.url as portainer_url
         FROM containers c
         LEFT JOIN portainer_instances pi ON c.source_instance_id = pi.id
         WHERE c.container_id = ? AND c.user_id = ?`,
        [containerId, userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!containerRecord) {
      // Container not in DB — may be a runner container (fetched live, never upserted).
      // Try to find it from the runner API and return a minimal debug response.
      const runnerDebugResponse = await buildRunnerDebugInfo(containerId, userId, db);
      if (runnerDebugResponse) {
        return res.json(runnerDebugResponse);
      }
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

    // Match registry_image_versions using normalized image_repo so "redis" matches "docker.io/redis"
    const registryImageVersion = containerRecord.image_repo
      ? await new Promise((resolve, reject) => {
          db.get(
            `SELECT * FROM registry_image_versions 
             WHERE user_id = ? AND tag = ? AND (
               image_repo = ? 
               OR REPLACE(COALESCE(image_repo, ''), 'docker.io/', '') = REPLACE(COALESCE(?, ''), 'docker.io/', '')
             )
             ORDER BY last_checked DESC
             LIMIT 1`,
            [userId, containerImageTag, containerRecord.image_repo, containerRecord.image_repo],
            (err, row) => {
              if (err) reject(err);
              else resolve(row);
            }
          );
        })
      : null;

    // Get all registry image versions for this image_repo (to see all tags), normalized so "redis" matches "docker.io/redis"
    const allRegistryImageVersions = containerRecord.image_repo
      ? await new Promise((resolve, reject) => {
          db.all(
            `SELECT * FROM registry_image_versions 
             WHERE user_id = ? AND (
               image_repo = ? 
               OR REPLACE(COALESCE(image_repo, ''), 'docker.io/', '') = REPLACE(COALESCE(?, ''), 'docker.io/', '')
             )
             ORDER BY last_checked DESC`,
            [userId, containerRecord.image_repo, containerRecord.image_repo],
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
        `SELECT c.*, pi.name as source_instance_name, pi.url as source_url,
                pi.name as portainer_name, pi.url as portainer_url
         FROM containers c
         LEFT JOIN portainer_instances pi ON c.source_instance_id = pi.id
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
        logger.debug(
          `Using stored RepoDigests for container ${containerRecord.container_name} (${repoDigests.length} digests)`
        );
      } catch (parseErr) {
        logger.debug(`Failed to parse stored repo_digests: ${parseErr.message}`);
      }
    }

    // If not in database, fetch from Portainer as fallback
    if (
      !repoDigests &&
      (containerRecord.source_url || containerRecord.portainer_url) &&
      containerRecord.endpoint_id
    ) {
      try {
        const portainerService = require("../services/portainerService");

        const sourceUrl = containerRecord.source_url || containerRecord.portainer_url;

        // First, get container details to obtain the Image ID
        const containerDetails = await portainerService.getContainerDetails(
          sourceUrl,
          containerRecord.endpoint_id,
          containerId
        );

        // Then fetch image details using the Image ID
        if (containerDetails?.Image) {
          const imageDetails = await portainerService.getImageDetails(
            sourceUrl,
            containerRecord.endpoint_id,
            containerDetails.Image
          );

          if (imageDetails.RepoDigests && Array.isArray(imageDetails.RepoDigests)) {
            // Clean RepoDigests: remove image name prefix (e.g., "postgres@sha256:..." -> "sha256:...")
            repoDigests = imageDetails.RepoDigests.map((rd) => {
              if (rd.includes("@sha256:")) {
                return "sha256:" + rd.split("@sha256:")[1];
              }
              return rd; // Already clean
            });
            logger.debug(
              `Fetched ${repoDigests.length} RepoDigests from Portainer for container ${containerRecord.container_name}`
            );
          }
        }
      } catch (imageError) {
        logger.debug(
          `Could not fetch RepoDigests for container ${containerId}: ${imageError.message}`
        );
      }
    }

    // Runner fallback: fetch RepoDigests live from the runner API
    if (!repoDigests && containerRecord.runner_id) {
      try {
        const runners = await getEnabledRunnersWithKeysByUser(userId);
        const runner = runners.find((r) => r.id === containerRecord.runner_id);
        if (runner) {
          const allContainers = await runnerDockerService.getContainers(
            runner.url,
            null,
            runner.api_key
          );
          const match = allContainers.find((c) => (c.Id || c.id) === containerId);
          if (match) {
            const raw = match.repoDigests || [];
            const cleaned = raw
              .map((rd) =>
                rd.includes("@sha256:") ? "sha256:" + rd.split("@sha256:")[1] : rd
              )
              .filter(Boolean);
            if (cleaned.length > 0) {
              repoDigests = cleaned;
              logger.debug(
                `Fetched ${repoDigests.length} RepoDigests from runner for container ${containerRecord.container_name}`
              );
            }
          }
        }
      } catch (runnerErr) {
        logger.debug(
          `Could not fetch RepoDigests from runner for container ${containerId}: ${runnerErr.message}`
        );
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

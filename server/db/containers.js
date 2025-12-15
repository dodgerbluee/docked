/**
 * Containers Database Module
 *
 * Handles all container-related database operations including:
 * - Container CRUD operations
 * - Container cleanup operations
 * - Container queries with update information
 */
/* eslint-disable max-lines -- Large database module with comprehensive container operations */

const logger = require("../utils/logger");
const { getDatabase, queueDatabaseOperation } = require("./connection");
const { upsertDeployedImage, cleanupOrphanedDeployedImages } = require("./deployedImages");

/**
 * Upsert container data
 * @param {number} userId - User ID
 * @param {number} portainerInstanceId - Portainer instance ID
 * @param {Object} containerData - Container data
 * @returns {Promise<number>} - ID of the record
 */
// eslint-disable-next-line max-lines-per-function -- Complex upsert logic needed for container management
function upsertContainer(userId, portainerInstanceId, containerData) {
  // eslint-disable-next-line max-lines-per-function, complexity -- Complex promise callback with upsert logic
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      const {
        containerId,
        containerName,
        endpointId,
        imageName,
        imageRepo,
        status = null,
        state = null,
        stackName = null,
        currentDigest = null,
        imageCreatedDate = null,
        usesNetworkMode = false,
        providesNetwork = false,
        imageTag = "latest",
        registry = null,
        namespace = null,
        repository = null,
      } = containerData;

      // Extract tag from imageName if not provided
      const tag = imageTag || (imageName.includes(":") ? imageName.split(":")[1] : "latest");

      // First, upsert deployed image
      upsertDeployedImage(userId, imageRepo, tag, currentDigest, {
        imageCreatedDate,
        registry,
        namespace,
        repository,
      })
        .then((deployedImageId) => {
          // Then upsert container with reference to deployed image
          db.run(
            `INSERT OR REPLACE INTO containers (
            user_id, portainer_instance_id, container_id, container_name, endpoint_id,
            image_name, image_repo, status, state, stack_name,
            deployed_image_id, uses_network_mode, provides_network,
            last_seen, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [
              userId,
              portainerInstanceId,
              containerId,
              containerName,
              endpointId,
              imageName,
              imageRepo,
              status,
              state,
              stackName,
              deployedImageId,
              usesNetworkMode ? 1 : 0,
              providesNetwork ? 1 : 0,
            ],
            function (err) {
              if (err) {
                reject(err);
              } else {
                resolve(this.lastID);
              }
            }
          );
        })
        .catch(reject);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Upsert container with deployed image and registry version data in a single transaction
 * Ensures atomicity - all succeed or all fail
 * @param {number} userId - User ID
 * @param {number} portainerInstanceId - Portainer instance ID
 * @param {Object} containerData - Container data
 * @param {Object} versionData - Registry version data (optional)
 * @returns {Promise<{containerId: number, deployedImageId: number, registryVersionId: number|null}>} - IDs of created/updated records
 */
// eslint-disable-next-line max-lines-per-function -- Complex versioned upsert logic
function upsertContainerWithVersion(
  userId,
  portainerInstanceId,
  containerData,
  versionData = null
) {
  return queueDatabaseOperation(() => {
    const db = getDatabase();

    // Extract container data
    const {
      containerId,
      containerName,
      endpointId,
      imageName,
      imageRepo,
      status = null,
      state = null,
      stackName = null,
      currentDigest = null,
      imageCreatedDate = null,
      usesNetworkMode = false,
      providesNetwork = false,
      imageTag = null,
      registry = null,
      namespace = null,
      repository = null,
    } = containerData;

    // Extract tag from imageName if not provided
    const tag = imageTag || (imageName.includes(":") ? imageName.split(":")[1] : "latest");

    return new Promise((resolve, reject) => {
      const commitTransaction = (containerRecordId, deployedImageId, registryVersionId = null) => {
        db.run("COMMIT", (commitErr) => {
          if (commitErr) {
            reject(commitErr);
          } else {
            resolve({
              containerId: containerRecordId,
              deployedImageId,
              registryVersionId,
            });
          }
        });
      };

      const handleVersionDataInsertion = (containerRecordId, deployedImageId) => {
        const {
          registry: vRegistry = registry || "docker.io",
          provider: vProvider = null,
          namespace: vNamespace = namespace,
          repository: vRepository = repository,
          currentTag = tag,
          latestTag = tag,
          latestVersion = null,
          latestDigest = null,
          latestPublishDate = null,
          existsInRegistry = true,
        } = versionData;

        logger.debug(`Inserting registry image version for ${imageRepo}:${currentTag}`, {
          registry: vRegistry,
          provider: vProvider,
          latestDigest: latestDigest ? `${latestDigest.substring(0, 12)}...` : null,
          latestVersion,
          latestTag,
          existsInRegistry,
        });

        db.run(
          `INSERT OR REPLACE INTO registry_image_versions (
            user_id, image_repo, registry, provider, namespace, repository, tag,
            latest_digest, latest_version, latest_publish_date,
            exists_in_registry, last_checked, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            userId,
            imageRepo,
            vRegistry,
            vProvider,
            vNamespace,
            vRepository || imageRepo,
            currentTag,
            latestDigest,
            latestVersion,
            latestPublishDate,
            existsInRegistry ? 1 : 0,
          ],
          function (versionErr) {
            if (versionErr) {
              logger.error(
                `Error inserting registry image version for ${imageRepo}:${currentTag}:`,
                versionErr
              );
              db.run("ROLLBACK");
              reject(versionErr);
              return;
            }

            logger.debug(
              `Successfully inserted registry image version for ${imageRepo}:${currentTag} (ID: ${this.lastID})`
            );

            commitTransaction(containerRecordId, deployedImageId, this.lastID);
          }
        );
      };

      const handleContainerInsertion = (deployedImageId) => {
        // Use a more robust upsert strategy: try UPDATE first, then INSERT if no rows affected
        // This avoids UNIQUE constraint violations in race conditions
        db.run(
          `UPDATE containers SET
            container_name = ?,
            image_name = ?,
            image_repo = ?,
            status = ?,
            state = ?,
            stack_name = ?,
            deployed_image_id = ?,
            uses_network_mode = ?,
            provides_network = ?,
            last_seen = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND container_id = ? AND portainer_instance_id = ? AND endpoint_id = ?`,
          [
            containerName,
            imageName,
            imageRepo,
            status,
            state,
            stackName,
            deployedImageId,
            usesNetworkMode ? 1 : 0,
            providesNetwork ? 1 : 0,
            userId,
            containerId,
            portainerInstanceId,
            endpointId,
          ],
          function (updateErr) {
            if (updateErr) {
              db.run("ROLLBACK");
              reject(updateErr);
              return;
            }

            // If rows were updated, use the existing row ID
            if (this.changes > 0) {
              // Get the ID of the updated row
              db.get(
                `SELECT id FROM containers 
                 WHERE user_id = ? AND container_id = ? AND portainer_instance_id = ? AND endpoint_id = ?`,
                [userId, containerId, portainerInstanceId, endpointId],
                (getErr, row) => {
                  if (getErr) {
                    db.run("ROLLBACK");
                    reject(getErr);
                    return;
                  }

                  const containerRecordId = row ? row.id : null;

                  // If version data is provided, upsert registry version
                  if (versionData && imageRepo) {
                    handleVersionDataInsertion(containerRecordId, deployedImageId);
                  } else {
                    // No version data - just commit container and deployed image update
                    commitTransaction(containerRecordId, deployedImageId, null);
                  }
                }
              );
            } else {
              // No rows updated, insert new record
              db.run(
                `INSERT INTO containers (
                  user_id, portainer_instance_id, container_id, container_name, endpoint_id,
                  image_name, image_repo, status, state, stack_name,
                  deployed_image_id, uses_network_mode, provides_network,
                  last_seen, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [
                  userId,
                  portainerInstanceId,
                  containerId,
                  containerName,
                  endpointId,
                  imageName,
                  imageRepo,
                  status,
                  state,
                  stackName,
                  deployedImageId,
                  usesNetworkMode ? 1 : 0,
                  providesNetwork ? 1 : 0,
                ],
                function (insertErr) {
                  if (insertErr) {
                    // If insert fails due to constraint, try update again (race condition)
                    if (insertErr.code === "SQLITE_CONSTRAINT") {
                      db.run(
                        `UPDATE containers SET
                          container_name = ?,
                          image_name = ?,
                          image_repo = ?,
                          status = ?,
                          state = ?,
                          stack_name = ?,
                          deployed_image_id = ?,
                          uses_network_mode = ?,
                          provides_network = ?,
                          last_seen = CURRENT_TIMESTAMP,
                          updated_at = CURRENT_TIMESTAMP
                        WHERE user_id = ? AND container_id = ? AND portainer_instance_id = ? AND endpoint_id = ?`,
                        [
                          containerName,
                          imageName,
                          imageRepo,
                          status,
                          state,
                          stackName,
                          deployedImageId,
                          usesNetworkMode ? 1 : 0,
                          providesNetwork ? 1 : 0,
                          userId,
                          containerId,
                          portainerInstanceId,
                          endpointId,
                        ],
                        function (retryUpdateErr) {
                          if (retryUpdateErr) {
                            db.run("ROLLBACK");
                            reject(retryUpdateErr);
                            return;
                          }

                          // Get the ID of the updated row
                          db.get(
                            `SELECT id FROM containers 
                             WHERE user_id = ? AND container_id = ? AND portainer_instance_id = ? AND endpoint_id = ?`,
                            [userId, containerId, portainerInstanceId, endpointId],
                            (getErr, row) => {
                              if (getErr) {
                                db.run("ROLLBACK");
                                reject(getErr);
                                return;
                              }

                              const containerRecordId = row ? row.id : null;

                              // If version data is provided, upsert registry version
                              if (versionData && imageRepo) {
                                handleVersionDataInsertion(containerRecordId, deployedImageId);
                              } else {
                                // No version data - just commit container and deployed image update
                                commitTransaction(containerRecordId, deployedImageId, null);
                              }
                            }
                          );
                        }
                      );
                    } else {
                      db.run("ROLLBACK");
                      reject(insertErr);
                    }
                    return;
                  }

                  const containerRecordId = this.lastID;

                  // If version data is provided, upsert registry version
                  if (versionData && imageRepo) {
                    handleVersionDataInsertion(containerRecordId, deployedImageId);
                  } else {
                    // No version data - just commit container and deployed image update
                    commitTransaction(containerRecordId, deployedImageId, null);
                  }
                }
              );
            }
          }
        );
      };

      try {
        db.serialize(() => {
          db.run("BEGIN IMMEDIATE TRANSACTION", (beginErr) => {
            if (beginErr) {
              db.run("ROLLBACK");
              reject(beginErr);
              return;
            }

            // First, upsert deployed image
            upsertDeployedImage(userId, imageRepo, tag, currentDigest, {
              imageCreatedDate,
              registry,
              namespace,
              repository,
            })
              .then(handleContainerInsertion)
              .catch((err) => {
                db.run("ROLLBACK");
                reject(err);
              });
          });
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Get all containers for a user (with deployed image info)
 * @param {number} userId - User ID
 * @param {string|null} portainerUrl - Optional filter by Portainer URL
 * @returns {Promise<Array>} - Array of containers
 */
// eslint-disable-next-line max-lines-per-function -- Container retrieval requires comprehensive database query logic
function getPortainerContainers(userId, portainerUrl = null) {
  // eslint-disable-next-line max-lines-per-function -- Promise callback requires comprehensive query processing
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      let query = `SELECT 
      c.*,
      di.image_digest as current_digest,
      di.image_created_date,
      di.image_tag,
      di.registry,
      di.namespace,
      di.repository
    FROM containers c
    LEFT JOIN deployed_images di ON c.deployed_image_id = di.id`;
      const params = [userId];

      if (portainerUrl) {
        query += ` JOIN portainer_instances pi ON c.portainer_instance_id = pi.id 
                   WHERE c.user_id = ? AND pi.url = ?`;
        params.push(portainerUrl);
      } else {
        query += ` WHERE c.user_id = ?`;
      }

      query += ` ORDER BY c.last_seen DESC`;

      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const containers = rows.map((row) => ({
            id: row.id,
            userId: row.user_id,
            portainerInstanceId: row.portainer_instance_id,
            containerId: row.container_id,
            containerName: row.container_name,
            endpointId: row.endpoint_id,
            imageName: row.image_name,
            imageRepo: row.image_repo,
            status: row.status,
            state: row.state,
            stackName: row.stack_name,
            currentDigest: row.current_digest,
            imageCreatedDate: row.image_created_date,
            imageTag: row.image_tag,
            deployedImageId: row.deployed_image_id,
            usesNetworkMode: row.uses_network_mode === 1,
            providesNetwork: row.provides_network === 1,
            lastSeen: row.last_seen,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }));
          resolve(containers);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get containers with update information (joined with deployed images and registry versions)
 * @param {number} userId - User ID
 * @param {string|null} portainerUrl - Optional filter
 * @returns {Promise<Array>} - Containers with update info
 */
// eslint-disable-next-line max-lines-per-function -- Container retrieval with updates requires comprehensive query logic
function getPortainerContainersWithUpdates(userId, portainerUrl = null) {
  // eslint-disable-next-line max-lines-per-function -- Promise callback requires comprehensive query processing
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();

      let query = `SELECT 
      c.*,
      di.image_digest as current_digest,
      di.image_created_date,
      di.image_tag,
      di.registry,
      riv.latest_digest as dh_latest_digest,
      riv.latest_version as dh_latest_version,
      riv.tag as dh_latest_tag,
      riv.latest_publish_date as dh_latest_publish_date,
      riv.provider as dh_provider,
      riv.last_checked as dh_last_checked,
      CASE 
        WHEN di.image_digest IS NOT NULL AND riv.latest_digest IS NOT NULL 
          AND di.image_digest != riv.latest_digest THEN 1
        ELSE 0
      END as dh_has_update,
      CASE
        WHEN di.id IS NOT NULL AND riv.id IS NOT NULL AND riv.latest_digest IS NULL THEN 1
        ELSE 0
      END as dh_no_digest
    FROM containers c
    LEFT JOIN deployed_images di ON c.deployed_image_id = di.id
    LEFT JOIN registry_image_versions riv 
      ON di.user_id = riv.user_id 
      AND di.image_repo = riv.image_repo
      AND di.image_tag = riv.tag`;

      const params = [userId];

      if (portainerUrl) {
        query += ` JOIN portainer_instances pi ON c.portainer_instance_id = pi.id 
                   WHERE c.user_id = ? AND pi.url = ?`;
        params.push(portainerUrl);
      } else {
        query += ` WHERE c.user_id = ?`;
      }

      query += ` ORDER BY c.last_seen DESC`;

      // Normalize digests for comparison (ensure both have sha256: prefix or both don't)
      const normalizeDigest = (digest) => {
        if (!digest) {
          return null;
        }
        // Ensure digest starts with sha256: for consistent comparison
        return digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
      };

      const { computeHasUpdate } = require("../utils/containerUpdateHelpers");

      const mapRowToContainer = (row) => {
        // Build container object first
        const containerData = {
          id: row.id,
          userId: row.user_id,
          portainerInstanceId: row.portainer_instance_id,
          containerId: row.container_id,
          containerName: row.container_name,
          endpointId: row.endpoint_id,
          imageName: row.image_name,
          imageRepo: row.image_repo,
          status: row.status,
          state: row.state,
          stackName: row.stack_name,
          currentDigest: row.current_digest,
          imageCreatedDate: row.image_created_date,
          imageTag: row.image_tag,
          deployedImageId: row.deployed_image_id,
          usesNetworkMode: row.uses_network_mode === 1,
          providesNetwork: row.provides_network === 1,
          latestDigest: row.dh_latest_digest,
          latestVersion: row.dh_latest_version,
          latestTag: row.dh_latest_tag,
          latestPublishDate: row.dh_latest_publish_date,
          provider: row.dh_provider || null, // Provider used to get version info (dockerhub, ghcr, gitlab, github-releases, etc.)
          noDigest: row.dh_no_digest === 1, // Flag: container was checked but no digest was returned
          lastChecked: row.dh_last_checked, // When the registry was last checked for this image
          lastSeen: row.last_seen,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };

        // Compute hasUpdate on-the-fly from digests
        containerData.hasUpdate = computeHasUpdate(containerData);

        return containerData;
      };

      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        const containers = rows.map(mapRowToContainer);
        resolve(containers);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Delete Portainer containers for a specific instance
 * @param {number} userId - User ID
 * @param {number} portainerInstanceId - Portainer instance ID
 * @returns {Promise<void>}
 */
function deletePortainerContainersForInstance(userId, portainerInstanceId) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        `DELETE FROM containers WHERE user_id = ? AND portainer_instance_id = ?`,
        [userId, portainerInstanceId],
        (err) => {
          if (err) {
            reject(err);
          } else {
            // Clean up orphaned deployed images after deleting containers
            cleanupOrphanedDeployedImages(userId)
              .then(() => resolve())
              .catch((cleanupErr) => {
                // Log but don't fail - orphaned images will be cleaned up later
                logger.warn("Error cleaning up orphaned deployed images:", cleanupErr);
                resolve();
              });
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Delete containers that are not in the provided list (for a specific instance and endpoint)
 * Used to clean up containers that were deleted from Portainer
 * @param {number} userId - User ID
 * @param {number} portainerInstanceId - Portainer instance ID
 * @param {string} endpointId - Endpoint ID
 * @param {Array<string>} currentContainerIds - Array of container IDs that currently exist
 * @returns {Promise<number>} - Number of deleted records
 */
// eslint-disable-next-line max-lines-per-function -- Container deletion requires comprehensive database operations
function deletePortainerContainersNotInList(
  userId,
  portainerInstanceId,
  endpointId,
  currentContainerIds
) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      if (!currentContainerIds || currentContainerIds.length === 0) {
        // If no current containers, delete all for this instance/endpoint
        db.run(
          `DELETE FROM containers WHERE user_id = ? AND portainer_instance_id = ? AND endpoint_id = ?`,
          [userId, portainerInstanceId, endpointId],
          function (err) {
            if (err) {
              reject(err);
            } else {
              // Clean up orphaned deployed images
              cleanupOrphanedDeployedImages(userId)
                .then(() => resolve(this.changes))
                .catch((cleanupErr) => {
                  logger.warn("Error cleaning up orphaned deployed images:", cleanupErr);
                  resolve(this.changes);
                });
            }
          }
        );
        return;
      }

      // Create placeholders for the IN clause
      const placeholders = currentContainerIds.map(() => "?").join(",");
      const params = [userId, portainerInstanceId, endpointId, ...currentContainerIds];

      db.run(
        `DELETE FROM containers 
         WHERE user_id = ? AND portainer_instance_id = ? AND endpoint_id = ? 
         AND container_id NOT IN (${placeholders})`,
        params,
        function (err) {
          if (err) {
            reject(err);
          } else {
            // Clean up orphaned deployed images
            cleanupOrphanedDeployedImages(userId)
              .then(() => resolve(this.changes))
              .catch((cleanupErr) => {
                logger.warn("Error cleaning up orphaned deployed images:", cleanupErr);
                resolve(this.changes);
              });
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Clean up stale containers (not seen in last N days)
 * @param {number} daysOld - Number of days old to consider stale
 * @returns {Promise<number>} - Number of deleted records
 */
function cleanupStalePortainerContainers(daysOld = 7) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.run(
        `DELETE FROM containers WHERE last_seen < datetime('now', '-' || ? || ' days')`,
        [daysOld],
        function (err) {
          if (err) {
            reject(err);
          } else {
            // Clean up orphaned deployed images after deleting stale containers
            // Get all user IDs that had containers deleted
            db.all(
              `SELECT DISTINCT user_id FROM containers WHERE last_seen < datetime('now', '-' || ? || ' days')`,
              [daysOld],
              (userErr, userRows) => {
                if (userErr) {
                  logger.warn("Error getting user IDs for cleanup:", userErr);
                  resolve(this.changes);
                } else {
                  // Clean up orphaned images for each user
                  const cleanupPromises = (userRows || []).map((row) =>
                    cleanupOrphanedDeployedImages(row.user_id).catch((cleanupErr) => {
                      logger.warn(
                        `Error cleaning up orphaned images for user ${row.user_id}:`,
                        cleanupErr
                      );
                    })
                  );
                  Promise.all(cleanupPromises)
                    .then(() => resolve(this.changes))
                    .catch(() => resolve(this.changes));
                }
              }
            );
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Clear all Portainer containers and Docker Hub versions for a user
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
// eslint-disable-next-line max-lines-per-function -- User data clearing requires comprehensive database operations
function clearUserContainerData(userId) {
  // eslint-disable-next-line max-lines-per-function -- Promise callback requires comprehensive deletion logic
  return new Promise((resolve, reject) => {
    try {
      const db = getDatabase();
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        // Delete ALL containers for this user
        db.run(`DELETE FROM containers WHERE user_id = ?`, [userId], (err1) => {
          if (err1) {
            db.run("ROLLBACK");
            reject(err1);
          } else {
            // Delete ALL deployed_images for this user
            db.run(`DELETE FROM deployed_images WHERE user_id = ?`, [userId], (err2) => {
              if (err2) {
                db.run("ROLLBACK");
                reject(err2);
              } else {
                // Delete ALL registry_image_versions for this user
                db.run(
                  `DELETE FROM registry_image_versions WHERE user_id = ?`,
                  [userId],
                  (err3) => {
                    if (err3) {
                      db.run("ROLLBACK");
                      reject(err3);
                    } else {
                      // eslint-disable-next-line max-nested-callbacks -- Transaction commit requires nested callbacks
                      db.run("COMMIT", (commitErr) => {
                        if (commitErr) {
                          reject(commitErr);
                        } else {
                          resolve();
                        }
                      });
                    }
                  }
                );
              }
            });
          }
        });
      });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  upsertContainer,
  upsertContainerWithVersion,
  getPortainerContainers,
  getPortainerContainersWithUpdates,
  deletePortainerContainersForInstance,
  deletePortainerContainersNotInList,
  cleanupStalePortainerContainers,
  clearUserContainerData,
};

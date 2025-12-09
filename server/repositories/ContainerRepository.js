/**
 * Container Repository
 * Handles all container-related database operations
 * Wraps domain module functions to provide repository pattern interface
 */

const BaseRepository = require("./BaseRepository");
const containerDb = require("../db/containers");

class ContainerRepository extends BaseRepository {
  /**
   * Upsert container data
   * @param {number} userId - User ID
   * @param {number} portainerInstanceId - Portainer instance ID
   * @param {Object} containerData - Container data
   * @returns {Promise<number>} - ID of the record
   */
  upsert(userId, portainerInstanceId, containerData) {
    return containerDb.upsertContainer(userId, portainerInstanceId, containerData);
  }

  /**
   * Upsert container with version data in a single transaction
   * @param {number} userId - User ID
   * @param {number} portainerInstanceId - Portainer instance ID
   * @param {Object} containerData - Container data
   * @param {Object} versionData - Version data
   * @returns {Promise<Object>} - Result with containerId, deployedImageId, registryVersionId
   */
  upsertWithVersion(userId, portainerInstanceId, containerData, versionData) {
    return containerDb.upsertContainerWithVersion(
      userId,
      portainerInstanceId,
      containerData,
      versionData,
    );
  }

  /**
   * Get all containers for a user
   * @param {number} userId - User ID
   * @param {string|null} portainerUrl - Optional filter by Portainer URL
   * @returns {Promise<Array>} - Array of containers
   */
  findByUser(userId, portainerUrl = null) {
    return containerDb.getPortainerContainers(userId, portainerUrl);
  }

  /**
   * Get containers with update information
   * @param {number} userId - User ID
   * @param {string|null} portainerUrl - Optional filter
   * @returns {Promise<Array>} - Containers with update info
   */
  findByUserWithUpdates(userId, portainerUrl = null) {
    return containerDb.getPortainerContainersWithUpdates(userId, portainerUrl);
  }

  /**
   * Delete containers for a specific Portainer instance
   * @param {number} userId - User ID
   * @param {number} portainerInstanceId - Portainer instance ID
   * @returns {Promise<void>}
   */
  deleteByInstance(userId, portainerInstanceId) {
    return containerDb.deletePortainerContainersForInstance(userId, portainerInstanceId);
  }

  /**
   * Delete containers not in the provided list
   * @param {number} userId - User ID
   * @param {number} portainerInstanceId - Portainer instance ID
   * @param {Array<string>} containerIds - List of container IDs to keep
   * @returns {Promise<void>}
   */
  deleteNotInList(userId, portainerInstanceId, containerIds) {
    return containerDb.deletePortainerContainersNotInList(
      userId,
      portainerInstanceId,
      containerIds,
    );
  }

  /**
   * Cleanup stale containers older than specified days
   * @param {number} daysOld - Number of days old (default: 7)
   * @returns {Promise<number>} - Number of containers deleted
   */
  cleanupStale(daysOld = 7) {
    return containerDb.cleanupStalePortainerContainers(daysOld);
  }

  /**
   * Clear all container data for a user
   * @param {number} userId - User ID
   * @returns {Promise<void>}
   */
  clearByUser(userId) {
    return containerDb.clearUserContainerData(userId);
  }
}

module.exports = ContainerRepository;

/**
 * Registry Image Version Repository
 * Handles all registry image version-related database operations
 * Wraps domain module functions to provide repository pattern interface
 */

const BaseRepository = require("./BaseRepository");
const registryImageVersionsDb = require("../db/registryImageVersions");

class RegistryImageVersionRepository extends BaseRepository {
  /**
   * Upsert registry image version
   * @param {number} userId - User ID
   * @param {string} imageRepo - Image repository
   * @param {string} tag - Image tag
   * @param {Object} versionData - Version data
   * @returns {Promise<number>} - ID of the record
   */
  async upsert(userId, imageRepo, tag, versionData) {
    return await registryImageVersionsDb.upsertRegistryImageVersion(
      userId,
      imageRepo,
      tag,
      versionData
    );
  }

  /**
   * Get registry image version
   * @param {number} userId - User ID
   * @param {string} imageRepo - Image repository
   * @param {string} tag - Image tag
   * @returns {Promise<Object|null>} - Registry image version or null
   */
  async findByUserAndImage(userId, imageRepo, tag) {
    return await registryImageVersionsDb.getRegistryImageVersion(userId, imageRepo, tag);
  }

  /**
   * Cleanup orphaned registry image versions
   * @param {number} userId - User ID
   * @returns {Promise<number>} - Number of versions cleaned up
   */
  async cleanupOrphaned(userId) {
    return await registryImageVersionsDb.cleanupOrphanedRegistryVersions(userId);
  }
}

module.exports = RegistryImageVersionRepository;

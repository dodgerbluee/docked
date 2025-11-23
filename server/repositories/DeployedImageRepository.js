/**
 * Deployed Image Repository
 * Handles all deployed image-related database operations
 * Wraps domain module functions to provide repository pattern interface
 */

const BaseRepository = require("./BaseRepository");
const deployedImagesDb = require("../db/deployedImages");

class DeployedImageRepository extends BaseRepository {
  /**
   * Upsert deployed image
   * @param {number} userId - User ID
   * @param {string} imageRepo - Image repository
   * @param {string} imageTag - Image tag
   * @param {string} imageDigest - Image digest
   * @param {Object} [options={}] - Additional options
   * @param {string} [options.imageCreatedDate] - Image created date
   * @param {string} [options.registry] - Registry
   * @param {string} [options.namespace] - Namespace
   * @param {string} [options.repository] - Repository
   * @returns {Promise<number>} - ID of the record
   */
  async upsert(userId, imageRepo, imageTag, imageDigest, options = {}) {
    return await deployedImagesDb.upsertDeployedImage(
      userId,
      imageRepo,
      imageTag,
      imageDigest,
      options
    );
  }

  /**
   * Get deployed image
   * @param {number} userId - User ID
   * @param {string} imageRepo - Image repository
   * @param {string} imageTag - Image tag
   * @param {string} imageDigest - Image digest
   * @returns {Promise<Object|null>} - Deployed image or null
   */
  async findByUserAndImage(userId, imageRepo, imageTag, imageDigest) {
    return await deployedImagesDb.getDeployedImage(userId, imageRepo, imageTag, imageDigest);
  }

  /**
   * Cleanup orphaned deployed images
   * @param {number} userId - User ID
   * @returns {Promise<number>} - Number of images cleaned up
   */
  async cleanupOrphaned(userId) {
    return await deployedImagesDb.cleanupOrphanedDeployedImages(userId);
  }
}

module.exports = DeployedImageRepository;


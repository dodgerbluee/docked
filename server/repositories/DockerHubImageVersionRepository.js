/**
 * Docker Hub Image Version Repository
 * Handles all Docker Hub image version-related database operations
 * Wraps domain module functions to provide repository pattern interface
 *
 * @deprecated This repository is for backward compatibility. New code should use RegistryImageVersionRepository.
 */

const BaseRepository = require("./BaseRepository");
const dockerHubImageVersionsDb = require("../db/dockerHubImageVersions");

class DockerHubImageVersionRepository extends BaseRepository {
  /**
   * Upsert Docker Hub image version information
   * @deprecated Use RegistryImageVersionRepository.upsert instead
   * @param {number} userId - User ID
   * @param {string} imageRepo - Image repository (without tag, e.g., "nginx")
   * @param {Object} versionData - Version data to store
   * @returns {Promise<number>} - ID of the record
   */
  upsert(userId, imageRepo, versionData) {
    return dockerHubImageVersionsDb.upsertDockerHubImageVersion(userId, imageRepo, versionData);
  }

  /**
   * Get Docker Hub version info for a specific image repo and tag
   * @param {number} userId - User ID
   * @param {string} imageRepo - Image repository
   * @param {string} currentTag - Current tag (optional, for backward compatibility)
   * @returns {Promise<Object|null>} - Version info or null
   */
  findByUserAndRepo(userId, imageRepo, currentTag = null) {
    return dockerHubImageVersionsDb.getDockerHubImageVersion(userId, imageRepo, currentTag);
  }

  /**
   * Get Docker Hub version info for multiple image repos (batch)
   * @param {number} userId - User ID
   * @param {Array<string>} imageRepos - Array of image repositories
   * @returns {Promise<Array>} - Array of version info objects
   */
  findByUserAndRepos(userId, imageRepos) {
    return dockerHubImageVersionsDb.getDockerHubImageVersionsBatch(userId, imageRepos);
  }

  /**
   * Get all Docker Hub images with updates available
   * @param {number} userId - User ID
   * @returns {Promise<Array>} - Array of images with updates
   */
  findWithUpdates(userId) {
    return dockerHubImageVersionsDb.getDockerHubImagesWithUpdates(userId);
  }

  /**
   * Mark Docker Hub image as up-to-date
   * @param {number} userId - User ID
   * @param {string} imageRepo - Image repository
   * @param {string} latestDigest - Latest digest
   * @param {string} latestVersion - Latest version
   * @param {string} currentTag - Current tag (optional)
   * @returns {Promise<void>}
   */
  markUpToDate(userId, imageRepo, latestDigest, latestVersion, currentTag = null) {
    return dockerHubImageVersionsDb.markDockerHubImageUpToDate(
      userId,
      imageRepo,
      latestDigest,
      latestVersion,
      currentTag
    );
  }
}

module.exports = DockerHubImageVersionRepository;

/**
 * Registry Repository
 * Handles all registry-related database operations
 * Wraps domain module functions to provide repository pattern interface
 */

const BaseRepository = require("./BaseRepository");
const registryDb = require("../db/registry");

class RegistryRepository extends BaseRepository {
  /**
   * Get Docker Hub credentials for a user
   * @param {number} userId - User ID
   * @returns {Promise<Object|null>} - Docker Hub credentials or null
   */
  getDockerHubCredentials(userId) {
    return registryDb.getDockerHubCredentials(userId);
  }

  /**
   * Update Docker Hub credentials for a user
   * @param {number} userId - User ID
   * @param {string} username - Docker Hub username
   * @param {string} token - Docker Hub personal access token
   * @returns {Promise<void>}
   */
  updateDockerHubCredentials(userId, username, token) {
    return registryDb.updateDockerHubCredentials(userId, username, token);
  }

  /**
   * Delete Docker Hub credentials for a user
   * @param {number} userId - User ID
   * @returns {Promise<void>}
   */
  deleteDockerHubCredentials(userId) {
    return registryDb.deleteDockerHubCredentials(userId);
  }

  /**
   * Get all repository access tokens for a user
   * @param {number} userId - User ID
   * @returns {Promise<Array>} - Array of repository access tokens
   */
  findRepositoryAccessTokensByUser(userId) {
    return registryDb.getAllRepositoryAccessTokens(userId);
  }

  /**
   * Get repository access token by provider
   * @param {number} userId - User ID
   * @param {string} provider - Provider name (e.g., "github", "gitlab")
   * @returns {Promise<Object|null>} - Repository access token or null
   */
  findRepositoryAccessTokenByProvider(userId, provider) {
    return registryDb.getRepositoryAccessTokenByProvider(userId, provider);
  }

  /**
   * Get repository access token by ID
   * @param {number} tokenId - Token ID
   * @param {number} userId - User ID
   * @returns {Promise<Object|null>} - Repository access token or null
   */
  findRepositoryAccessTokenById(tokenId, userId) {
    return registryDb.getRepositoryAccessTokenById(tokenId, userId);
  }

  /**
   * Upsert repository access token
   * @param {number} userId - User ID
   * @param {string} provider - Provider name
   * @param {string} name - Token name
   * @param {string} accessToken - Access token
   * @param {number} [tokenId] - Token ID (for updates)
   * @returns {Promise<number>} - Token ID
   */
  upsertRepositoryAccessToken(userId, provider, name, accessToken, tokenId = null) {
    return registryDb.upsertRepositoryAccessToken(userId, provider, name, accessToken, tokenId);
  }

  /**
   * Delete repository access token
   * @param {number} id - Token ID
   * @param {number} userId - User ID
   * @returns {Promise<void>}
   */
  deleteRepositoryAccessToken(id, userId) {
    return registryDb.deleteRepositoryAccessToken(id, userId);
  }

  /**
   * Associate images with a repository access token
   * @param {number} userId - User ID
   * @param {number} tokenId - Token ID
   * @param {Array<string>} imageRepos - Array of image repository names
   * @returns {Promise<void>}
   */
  associateImagesWithToken(userId, tokenId, imageRepos) {
    return registryDb.associateImagesWithToken(userId, tokenId, imageRepos);
  }

  /**
   * Get associated images for a repository access token
   * @param {number} userId - User ID
   * @param {number} tokenId - Token ID
   * @returns {Promise<Array>} - Array of associated image repository names
   */
  getAssociatedImagesForToken(userId, tokenId) {
    return registryDb.getAssociatedImagesForToken(userId, tokenId);
  }
}

module.exports = RegistryRepository;

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
  async getDockerHubCredentials(userId) {
    return await registryDb.getDockerHubCredentials(userId);
  }

  /**
   * Update Docker Hub credentials for a user
   * @param {number} userId - User ID
   * @param {string} username - Docker Hub username
   * @param {string} token - Docker Hub personal access token
   * @returns {Promise<void>}
   */
  async updateDockerHubCredentials(userId, username, token) {
    return await registryDb.updateDockerHubCredentials(userId, username, token);
  }

  /**
   * Delete Docker Hub credentials for a user
   * @param {number} userId - User ID
   * @returns {Promise<void>}
   */
  async deleteDockerHubCredentials(userId) {
    return await registryDb.deleteDockerHubCredentials(userId);
  }

  /**
   * Get all repository access tokens for a user
   * @param {number} userId - User ID
   * @returns {Promise<Array>} - Array of repository access tokens
   */
  async findRepositoryAccessTokensByUser(userId) {
    return await registryDb.getAllRepositoryAccessTokens(userId);
  }

  /**
   * Get repository access token by provider
   * @param {number} userId - User ID
   * @param {string} provider - Provider name (e.g., "github", "gitlab")
   * @returns {Promise<Object|null>} - Repository access token or null
   */
  async findRepositoryAccessTokenByProvider(userId, provider) {
    return await registryDb.getRepositoryAccessTokenByProvider(userId, provider);
  }

  /**
   * Get repository access token by ID
   * @param {number} tokenId - Token ID
   * @param {number} userId - User ID
   * @returns {Promise<Object|null>} - Repository access token or null
   */
  async findRepositoryAccessTokenById(tokenId, userId) {
    return await registryDb.getRepositoryAccessTokenById(tokenId, userId);
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
  async upsertRepositoryAccessToken(userId, provider, name, accessToken, tokenId = null) {
    return await registryDb.upsertRepositoryAccessToken(
      userId,
      provider,
      name,
      accessToken,
      tokenId
    );
  }

  /**
   * Delete repository access token
   * @param {number} id - Token ID
   * @param {number} userId - User ID
   * @returns {Promise<void>}
   */
  async deleteRepositoryAccessToken(id, userId) {
    return await registryDb.deleteRepositoryAccessToken(id, userId);
  }

  /**
   * Associate images with a repository access token
   * @param {number} userId - User ID
   * @param {number} tokenId - Token ID
   * @param {Array<string>} imageRepos - Array of image repository names
   * @returns {Promise<void>}
   */
  async associateImagesWithToken(userId, tokenId, imageRepos) {
    return await registryDb.associateImagesWithToken(userId, tokenId, imageRepos);
  }

  /**
   * Get associated images for a repository access token
   * @param {number} userId - User ID
   * @param {number} tokenId - Token ID
   * @returns {Promise<Array>} - Array of associated image repository names
   */
  async getAssociatedImagesForToken(userId, tokenId) {
    return await registryDb.getAssociatedImagesForToken(userId, tokenId);
  }
}

module.exports = RegistryRepository;

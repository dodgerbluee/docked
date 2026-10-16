/**
 * Repository Access Token Controller
 * Handles CRUD operations for repository access tokens (GitHub/GitLab)
 */

const {
  getAllRepositoryAccessTokens,
  getRepositoryAccessTokenByProvider,
  getRepositoryAccessTokenById,
  upsertRepositoryAccessToken,
  deleteRepositoryAccessToken,
  associateImagesWithToken,
  getAssociatedImagesForToken,
} = require("../db/index");
// const logger = require("../utils/logger"); // Unused

/**
 * Create or update a repository access token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */

/**
 * Associate image repositories with a repository access token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function associateImages(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const { id } = req.params;
    const { imageRepos } = req.body;

    // Validate token exists
    const token = await getRepositoryAccessTokenById(parseInt(id, 10), userId);
    if (!token) {
      return res.status(404).json({
        success: false,
        error: "Repository access token not found",
      });
    }

    // Validate imageRepos
    if (!Array.isArray(imageRepos)) {
      return res.status(400).json({
        success: false,
        error: "imageRepos must be an array",
      });
    }

    await associateImagesWithToken(userId, parseInt(id, 10), imageRepos);

    return res.json({
      success: true,
      message: "Images associated with token successfully",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get associated images for a repository access token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getAssociatedImages(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const { id } = req.params;

    // Validate token exists
    const token = await getRepositoryAccessTokenById(parseInt(id, 10), userId);
    if (!token) {
      return res.status(404).json({
        success: false,
        error: "Repository access token not found",
      });
    }

    const imageRepos = await getAssociatedImagesForToken(userId, parseInt(id, 10));

    return res.json({
      success: true,
      imageRepos,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  associateImages,
  getAssociatedImages,
};

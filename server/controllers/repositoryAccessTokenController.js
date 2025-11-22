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
} = require("../db/database");
const { validateRequiredFields } = require("../utils/validation");
const logger = require("../utils/logger");

/**
 * Get all repository access tokens for a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getTokens(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const tokens = await getAllRepositoryAccessTokens(userId);
    res.json({
      success: true,
      tokens,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get a repository access token by provider
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getTokenByProvider(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const { provider } = req.params;

    if (!["github", "gitlab"].includes(provider)) {
      return res.status(400).json({
        success: false,
        error: "Provider must be 'github' or 'gitlab'",
      });
    }

    const token = await getRepositoryAccessTokenByProvider(userId, provider);

    if (!token) {
      return res.status(404).json({
        success: false,
        error: "Repository access token not found",
      });
    }

    res.json({
      success: true,
      token,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Create or update a repository access token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function upsertToken(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const { provider, name, accessToken, tokenId } = req.body;

    // Validate required fields
    const validationError = validateRequiredFields({ provider, name }, ["provider", "name"]);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    // Validate provider
    if (!["github", "gitlab"].includes(provider)) {
      return res.status(400).json({
        success: false,
        error: "Provider must be 'github' or 'gitlab'",
      });
    }

    // Validate name is not empty
    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Token name is required",
      });
    }

    // Validate access token is required for new tokens
    if (!tokenId && (!accessToken || accessToken.trim().length === 0)) {
      return res.status(400).json({
        success: false,
        error: "Access token is required",
      });
    }

    // If updating existing token and no access token provided, keep existing token
    if (tokenId && (!accessToken || accessToken.trim().length === 0)) {
      // Get existing token to verify it exists
      const existingToken = await getRepositoryAccessTokenById(tokenId, userId);
      if (!existingToken) {
        return res.status(404).json({
          success: false,
          error: "Repository access token not found",
        });
      }
      // Update name only, keep existing token
      const id = await upsertRepositoryAccessToken(
        userId,
        provider,
        name.trim(),
        existingToken.access_token,
        tokenId
      );
      return res.json({
        success: true,
        message: "Repository access token updated successfully",
        id,
      });
    }

    const id = await upsertRepositoryAccessToken(
      userId,
      provider,
      name.trim(),
      accessToken.trim(),
      tokenId || null
    );

    res.json({
      success: true,
      message: "Repository access token saved successfully",
      id,
    });
  } catch (error) {
    // Handle unique constraint violation
    if (error.message.includes("UNIQUE constraint failed")) {
      return res.status(400).json({
        success: false,
        error: "A token with this name already exists for this provider",
      });
    }
    next(error);
  }
}

/**
 * Delete a repository access token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function deleteToken(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    const { id } = req.params;

    // Check if token exists
    const tokens = await getAllRepositoryAccessTokens(userId);
    const token = tokens.find((t) => t.id === parseInt(id));

    if (!token) {
      return res.status(404).json({
        success: false,
        error: "Repository access token not found",
      });
    }

    await deleteRepositoryAccessToken(parseInt(id), userId);

    res.json({
      success: true,
      message: "Repository access token deleted successfully",
    });
  } catch (error) {
    next(error);
  }
}

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
    const token = await getRepositoryAccessTokenById(parseInt(id), userId);
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

    await associateImagesWithToken(userId, parseInt(id), imageRepos);

    res.json({
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
    const token = await getRepositoryAccessTokenById(parseInt(id), userId);
    if (!token) {
      return res.status(404).json({
        success: false,
        error: "Repository access token not found",
      });
    }

    const imageRepos = await getAssociatedImagesForToken(userId, parseInt(id));

    res.json({
      success: true,
      imageRepos,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getTokens,
  getTokenByProvider,
  upsertToken,
  deleteToken,
  associateImages,
  getAssociatedImages,
};

/**
 * Container Tools Utility
 * 
 * Provides functions to interact with container registries using
 * command-line tools like crane and skopeo.
 * 
 * These tools avoid the need for:
 * - GitHub tokens/PATs
 * - GitHub Apps
 * - API rate limits
 * - Complex authentication flows
 */

const { exec } = require("child_process");
const { promisify } = require("util");
const logger = require("./logger");

const execAsync = promisify(exec);

/**
 * Check if a command is available
 * @param {string} command - Command to check
 * @returns {Promise<boolean>} - True if command is available
 */
async function isCommandAvailable(command) {
  try {
    const { stdout } = await execAsync(`which ${command}`, { timeout: 5000 });
    return !!stdout.trim();
  } catch (error) {
    // On Windows, try 'where' instead of 'which'
    try {
      const { stdout } = await execAsync(`where ${command}`, { timeout: 5000 });
      return !!stdout.trim();
    } catch (winError) {
      return false;
    }
  }
}

/**
 * Get image digest using crane
 * @param {string} imageRef - Full image reference (e.g., ghcr.io/owner/repo:tag)
 * @returns {Promise<string|null>} - Digest or null if failed
 */
async function getDigestWithCrane(imageRef) {
  try {
    const { stdout, stderr } = await execAsync(`crane digest ${imageRef}`, {
      timeout: 30000, // 30 second timeout
      maxBuffer: 1024 * 1024, // 1MB buffer
    });

    if (stderr && !stderr.includes("Pulling")) {
      logger.debug(`[crane] stderr for ${imageRef}:`, stderr);
    }

    const digest = stdout.trim();
    if (digest && digest.startsWith("sha256:")) {
      return digest;
    }

    logger.warn(`[crane] Unexpected output for ${imageRef}:`, digest);
    return null;
  } catch (error) {
    logger.debug(`[crane] Failed to get digest for ${imageRef}:`, error.message);
    return null;
  }
}

/**
 * Get image digest using skopeo
 * @param {string} imageRef - Full image reference (e.g., ghcr.io/owner/repo:tag)
 * @returns {Promise<string|null>} - Digest or null if failed
 */
async function getDigestWithSkopeo(imageRef) {
  try {
    // skopeo inspect returns JSON, we need to parse it
    const { stdout, stderr } = await execAsync(
      `skopeo inspect --no-tags docker://${imageRef}`,
      {
        timeout: 30000, // 30 second timeout
        maxBuffer: 1024 * 1024, // 1MB buffer
      }
    );

    if (stderr && !stderr.includes("Getting image source")) {
      logger.debug(`[skopeo] stderr for ${imageRef}:`, stderr);
    }

    try {
      const manifest = JSON.parse(stdout);
      // Skopeo returns Digest in the manifest
      const digest = manifest.Digest;
      if (digest && digest.startsWith("sha256:")) {
        return digest;
      }
    } catch (parseError) {
      logger.warn(`[skopeo] Failed to parse JSON for ${imageRef}:`, parseError.message);
      return null;
    }

    return null;
  } catch (error) {
    logger.debug(`[skopeo] Failed to get digest for ${imageRef}:`, error.message);
    return null;
  }
}

/**
 * Get image digest using available tool (crane preferred, skopeo as fallback)
 * @param {string} imageRef - Full image reference (e.g., ghcr.io/owner/repo:tag)
 * @returns {Promise<string|null>} - Digest or null if failed
 */
async function getImageDigest(imageRef) {
  // Try crane first (simpler, faster)
  const craneAvailable = await isCommandAvailable("crane");
  if (craneAvailable) {
    logger.debug(`[containerTools] Using crane to get digest for ${imageRef}`);
    const digest = await getDigestWithCrane(imageRef);
    if (digest) {
      return digest;
    }
    logger.debug(`[containerTools] crane failed for ${imageRef}, trying skopeo`);
  }

  // Fallback to skopeo
  const skopeoAvailable = await isCommandAvailable("skopeo");
  if (skopeoAvailable) {
    logger.debug(`[containerTools] Using skopeo to get digest for ${imageRef}`);
    const digest = await getDigestWithSkopeo(imageRef);
    if (digest) {
      return digest;
    }
  }

  // Neither tool available or both failed
  if (!craneAvailable && !skopeoAvailable) {
    logger.warn(`[containerTools] Neither crane nor skopeo is available. Please install one of them.`);
  }

  return null;
}

module.exports = {
  getImageDigest,
  getDigestWithCrane,
  getDigestWithSkopeo,
  isCommandAvailable,
};


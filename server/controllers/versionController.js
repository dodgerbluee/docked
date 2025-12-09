/**
 * Version Controller
 * Returns the application version from package.json
 * Handles multiple package.json locations for different deployment scenarios
 */

const path = require("path");
const fs = require("fs");
const githubService = require("../services/githubService");
const logger = require("../utils/logger");

/**
 * Get application version
 * Reads version from package.json and determines build type
 *
 * @route GET /api/version
 * @access Public (no authentication required)
 * @returns {Object} Version information
 * @returns {string|null} version - Application version string
 * @returns {string} environment - Current NODE_ENV
 * @returns {boolean} isDevBuild - Whether this is a local development build
 */
// eslint-disable-next-line complexity -- Complex version detection logic
const getVersion = (req, res) => {
  try {
    const isDevelopment = process.env.NODE_ENV !== "production";

    // Try multiple locations for package.json
    // 1. Root package.json (for local dev and when copied to Docker)
    const rootPackageJsonPath = path.join(__dirname, "..", "..", "package.json");
    // 2. Server package.json (fallback in Docker if root isn't copied)
    const serverPackageJsonPath = path.join(__dirname, "..", "package.json");

    let packageJsonPath = null;
    if (fs.existsSync(rootPackageJsonPath)) {
      packageJsonPath = rootPackageJsonPath;
    } else if (fs.existsSync(serverPackageJsonPath)) {
      packageJsonPath = serverPackageJsonPath;
    }

    if (packageJsonPath) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const version = packageJson.version || null;
      let isDevBuild = false;

      /**
       * Determine if this is a local development build
       * Logic:
       * 1. Version "1.0.0" = unversioned local dev build
       * 2. Version without "-dev" suffix + development mode = local dev build
       * 3. Version with "-dev" suffix = formal dev release (not local dev)
       * 4. Version without "-dev" suffix + production mode = production release
       */
      if (version === "1.0.0") {
        // Unversioned local development
        isDevBuild = true;
      } else if (version && !version.includes("-dev") && isDevelopment) {
        // Versioned local development (e.g., running locally with version from master)
        isDevBuild = true;
      }
      // Versions with "-dev" suffix are formal dev releases, not local dev builds

      return res.json({
        version,
        environment: process.env.NODE_ENV || "development",
        isDevBuild, // Flag to indicate this is a local development build
      });
    }

    // If package.json doesn't exist, return null (for local dev)
    return res.json({
      version: null,
      environment: process.env.NODE_ENV || "development",
    });
  } catch (_error) {
    // On error, return null version (graceful degradation)
    return res.json({
      version: null,
      environment: process.env.NODE_ENV || "development",
    });
  }
};

/**
 * Get latest release from GitHub
 * Proxies the GitHub API call through the backend for better error handling and logging
 *
 * @route GET /api/version/latest-release
 * @access Public (no authentication required)
 * @returns {Object} Latest release information
 * @returns {boolean} success - Whether the request was successful
 * @returns {Object|null} latestVersion - Latest release info or null
 * @returns {string|null} error - Error message if request failed
 */
// eslint-disable-next-line complexity -- Complex release checking logic
const getLatestRelease = async (req, res) => {
  const GITHUB_REPO = "dodgerbluee/docked";

  try {
    logger.info(`[Version] Checking for latest release from GitHub: ${GITHUB_REPO}`);

    const latestRelease = await githubService.getLatestRelease(GITHUB_REPO);

    if (latestRelease && latestRelease.tag_name) {
      logger.info(`[Version] Latest release found: ${latestRelease.tag_name}`, {
        tag_name: latestRelease.tag_name,
        published_at: latestRelease.published_at,
        html_url: latestRelease.html_url,
      });

      return res.json({
        success: true,
        latestVersion: latestRelease,
      });
    }

    logger.warn(`[Version] No releases found for ${GITHUB_REPO}`);
    return res.json({
      success: false,
      latestVersion: null,
      error: "No releases found",
    });
  } catch (error) {
    const errorMessage = error?.message || String(error);
    const statusCode = error?.response?.status || error?.status || 500;
    const statusText = error?.response?.statusText || "Unknown error";

    logger.error(`[Version] Error fetching latest release from GitHub: ${errorMessage}`, {
      statusCode,
      statusText,
      repo: GITHUB_REPO,
      errorDetails: {
        message: error?.message,
        response: error?.response
          ? {
            status: error.response.status,
            statusText: error.response.statusText,
            headers: error.response.headers,
          }
          : null,
      },
    });

    return res.status(500).json({
      success: false,
      latestVersion: null,
      error: `Failed to check for updates: ${errorMessage}`,
    });
  }
};

module.exports = {
  getVersion,
  getLatestRelease,
};

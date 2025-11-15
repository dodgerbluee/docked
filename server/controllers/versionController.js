/**
 * Version Controller
 * Returns the application version from package.json
 * Handles multiple package.json locations for different deployment scenarios
 */

const path = require("path");
const fs = require("fs");

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
  } catch (error) {
    // On error, return null version (graceful degradation)
    return res.json({
      version: null,
      environment: process.env.NODE_ENV || "development",
    });
  }
};

module.exports = {
  getVersion,
};

/**
 * Nginx Proxy Manager Service
 * 
 * Handles special logic for upgrading nginx-proxy-manager containers,
 * including IP address fallback to ensure Portainer API calls work
 * when nginx goes down during upgrade.
 * Extracted from containerUpgradeService to improve modularity.
 */

const { URL } = require("url");
const { getAllPortainerInstances } = require("../../db/index");
const logger = require("../../utils/logger");

/**
 * Detect if a container is nginx-proxy-manager
 * @param {string} imageName - Image name
 * @returns {boolean} - True if nginx-proxy-manager
 */
function isNginxProxyManager(imageName) {
  return imageName.toLowerCase().includes("nginx-proxy-manager");
}

/**
 * Get IP-based Portainer URL for nginx-proxy-manager upgrades
 * @param {string} portainerUrl - Original Portainer URL
 * @returns {Promise<{workingUrl: string, ipAddress: string|null}>} - Working URL and IP address
 */
async function getIpBasedPortainerUrl(portainerUrl) {
  try {
    const instances = await getAllPortainerInstances();
    const instance = instances.find((inst) => inst.url === portainerUrl);

    if (instance && instance.ip_address) {
      const originalUrl = new URL(portainerUrl);
      const ipAddress = instance.ip_address;
      const originalPort =
        originalUrl.port || (originalUrl.protocol === "https:" ? "9443" : "9000");

      // Create IP-based URL
      const workingPortainerUrl = `${originalUrl.protocol}//${ipAddress}:${originalPort}`;

      logger.info(
        `Detected nginx-proxy-manager upgrade, using IP-based Portainer URL: ${workingPortainerUrl}`,
        {
          module: "containerUpgradeService",
          operation: "upgradeSingleContainer",
          originalUrl: portainerUrl,
          ipUrl: workingPortainerUrl,
          ipAddress: ipAddress,
          instanceName: instance.name || "unknown",
          instanceId: instance.id,
          warning:
            "  If upgrade fails, verify the IP address in Settings > Portainer Instances matches the actual Portainer server IP",
        }
      );

      // Log a clear warning about the IP being used
      logger.warn(
        `Using IP address ${ipAddress} from database for Portainer instance "${instance.name || portainerUrl}". ` +
          `If this is incorrect, update it in Settings > Portainer Instances.`,
        {
          module: "containerUpgradeService",
          operation: "upgradeSingleContainer",
          portainerUrl: portainerUrl,
          storedIpAddress: ipAddress,
          instanceName: instance.name,
          instanceId: instance.id,
        }
      );

      return {
        workingUrl: workingPortainerUrl,
        ipAddress: ipAddress,
      };
    } else {
      logger.warn(
        `No IP address cached for Portainer instance ${portainerUrl}, upgrade may fail if DNS is unavailable`
      );
      return {
        workingUrl: portainerUrl,
        ipAddress: null,
      };
    }
  } catch (error) {
    logger.error("Error getting IP address for Portainer instance:", { error });
    // Continue with original URL - fallback will handle it
    return {
      workingUrl: portainerUrl,
      ipAddress: null,
    };
  }
}

module.exports = {
  isNginxProxyManager,
  getIpBasedPortainerUrl,
};


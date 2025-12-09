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
 * Build IP-based URL from original URL and IP address
 * @param {URL} originalUrl - Original URL object
 * @param {string} ipAddress - IP address
 * @returns {string} - IP-based URL
 */
function buildIpUrl(originalUrl, ipAddress) {
  const originalPort = originalUrl.port || (originalUrl.protocol === "https:" ? "9443" : "9000");
  return `${originalUrl.protocol}//${ipAddress}:${originalPort}`;
}

/**
 * Log IP-based URL usage
 * @param {string} workingPortainerUrl - Working Portainer URL
 * @param {string} portainerUrl - Original Portainer URL
 * @param {string} ipAddress - IP address
 * @param {Object} instance - Portainer instance
 * @returns {void}
 */
function logIpUrlUsage(workingPortainerUrl, portainerUrl, ipAddress, instance) {
  logger.info(
    `Detected nginx-proxy-manager upgrade, using IP-based Portainer URL: ${workingPortainerUrl}`,
    {
      module: "containerUpgradeService",
      operation: "upgradeSingleContainer",
      originalUrl: portainerUrl,
      ipUrl: workingPortainerUrl,
      ipAddress,
      instanceName: instance.name || "unknown",
      instanceId: instance.id,
      warning:
        "  If upgrade fails, verify the IP address in Settings > Portainer Instances matches the actual Portainer server IP",
    }
  );

  logger.warn(
    `Using IP address ${ipAddress} from database for Portainer instance "${instance.name || portainerUrl}". ` +
      `If this is incorrect, update it in Settings > Portainer Instances.`,
    {
      module: "containerUpgradeService",
      operation: "upgradeSingleContainer",
      portainerUrl,
      storedIpAddress: ipAddress,
      instanceName: instance.name,
      instanceId: instance.id,
    }
  );
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
      const workingPortainerUrl = buildIpUrl(originalUrl, ipAddress);

      logIpUrlUsage(workingPortainerUrl, portainerUrl, ipAddress, instance);

      return {
        workingUrl: workingPortainerUrl,
        ipAddress,
      };
    }

    logger.warn(
      `No IP address cached for Portainer instance ${portainerUrl}, upgrade may fail if DNS is unavailable`
    );
    return {
      workingUrl: portainerUrl,
      ipAddress: null,
    };
  } catch (error) {
    logger.error("Error getting IP address for Portainer instance:", { error });
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

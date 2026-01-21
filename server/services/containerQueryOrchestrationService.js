/**
 * Container Query Orchestration Service
 *
 * Handles high-level orchestration logic for container queries, including
 * instance fetching and filtering.
 * Extracted from containerQueryService to improve modularity.
 */

const {
  getAllPortainerInstances,
  getAllPortainerInstancesForUsers,
  getAllUsers,
} = require("../db/index");
const logger = require("../utils/logger");

/**
 * Get Portainer instances to process
 * @param {number|null} userId - User ID (null for all users)
 * @param {string|null} filterPortainerUrl - Optional filter by Portainer URL
 * @returns {Promise<Array<Object>>} - Array of Portainer instances
 */
async function getPortainerInstancesToProcess(userId, filterPortainerUrl = null) {
  let portainerInstances = [];

  if (userId) {
    logger.debug(`📋 Fetching Portainer instances for userId=${userId}`);
    portainerInstances = await getAllPortainerInstances(userId);
    logger.debug(`📋 Found ${portainerInstances.length} instances for userId=${userId}`);
  } else {
    // For batch jobs, get all users and their instances in a single query (avoid N+1)
    logger.debug("📋 Fetching Portainer instances for all users");
    const users = await getAllUsers();
    const userIds = users.map((user) => user.id);
    if (userIds.length > 0) {
      portainerInstances = await getAllPortainerInstancesForUsers(userIds);
    }
    logger.debug(`📋 Found ${portainerInstances.length} instances across ${users.length} users`);
  }

  // Filter to specific instance if requested
  if (filterPortainerUrl) {
    const beforeFilter = portainerInstances.length;
    portainerInstances = portainerInstances.filter((inst) => inst.url === filterPortainerUrl);
    logger.debug(
      `📋 Filtered instances by URL: ${beforeFilter} -> ${portainerInstances.length} (filter: ${filterPortainerUrl})`
    );
  }

  return portainerInstances;
}

module.exports = {
  getPortainerInstancesToProcess,
};

/**
 * Container Query Orchestration Service
 * 
 * Handles high-level orchestration logic for container queries, including
 * instance fetching and filtering.
 * Extracted from containerQueryService to improve modularity.
 */

const { getAllPortainerInstances, getAllPortainerInstancesForUsers, getAllUsers } = require("../db/index");

/**
 * Get Portainer instances to process
 * @param {number|null} userId - User ID (null for all users)
 * @param {string|null} filterPortainerUrl - Optional filter by Portainer URL
 * @returns {Promise<Array<Object>>} - Array of Portainer instances
 */
async function getPortainerInstancesToProcess(userId, filterPortainerUrl = null) {
  let portainerInstances = [];

  if (userId) {
    portainerInstances = await getAllPortainerInstances(userId);
  } else {
    // For batch jobs, get all users and their instances in a single query (avoid N+1)
    const users = await getAllUsers();
    const userIds = users.map((user) => user.id);
    if (userIds.length > 0) {
      portainerInstances = await getAllPortainerInstancesForUsers(userIds);
    }
  }

  // Filter to specific instance if requested
  if (filterPortainerUrl) {
    portainerInstances = portainerInstances.filter((inst) => inst.url === filterPortainerUrl);
  }

  return portainerInstances;
}

module.exports = {
  getPortainerInstancesToProcess,
};


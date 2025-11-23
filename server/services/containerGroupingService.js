/**
 * Container Grouping Service
 *
 * Handles grouping of containers by stack and Portainer instance.
 * Extracted from containerQueryService to improve modularity.
 */

/**
 * Group containers by stack name
 * @param {Array<Object>} containers - Array of container objects
 * @param {string} defaultStackName - Default stack name for containers without a stack (default: "Standalone")
 * @returns {Array<Object>} - Array of stack objects with name and containers
 */
function groupContainersByStack(containers, defaultStackName = "Standalone") {
  if (!containers || containers.length === 0) {
    return [];
  }

  // Group containers by stack
  const groupedByStack = containers.reduce((acc, container) => {
    const stackName = container.stackName || defaultStackName;
    if (!acc[stackName]) {
      acc[stackName] = [];
    }
    acc[stackName].push(container);
    return acc;
  }, {});

  // Convert to array format with stack names
  const groupedContainers = Object.keys(groupedByStack).map((stackName) => ({
    stackName: stackName,
    containers: groupedByStack[stackName],
  }));

  // Sort stacks: named stacks first, then default stack name
  groupedContainers.sort((a, b) => {
    if (a.stackName === defaultStackName) {
      return 1;
    }
    if (b.stackName === defaultStackName) {
      return -1;
    }
    return a.stackName.localeCompare(b.stackName);
  });

  return groupedContainers;
}

/**
 * Group containers by stack using Map-based approach (for compatibility with existing code)
 * @param {Array<Object>} containers - Array of container objects
 * @param {string} unstackedName - Name for unstacked containers (default: "Unstacked")
 * @returns {Object} - Object with stacks array and unstackedContainers array
 */
function groupContainersByStackWithUnstacked(containers, unstackedName = "Unstacked") {
  const stacksMap = new Map();
  const unstackedContainers = [];

  for (const container of containers) {
    if (container.stackName) {
      if (!stacksMap.has(container.stackName)) {
        stacksMap.set(container.stackName, []);
      }
      stacksMap.get(container.stackName).push(container);
    } else {
      unstackedContainers.push(container);
    }
  }

  const stacks = Array.from(stacksMap.entries()).map(([name, containers]) => ({
    name,
    containers,
  }));

  if (unstackedContainers.length > 0) {
    stacks.push({
      name: unstackedName,
      containers: unstackedContainers,
    });
  }

  return {
    stacks,
    unstackedContainers,
  };
}

/**
 * Group containers by Portainer instance
 * @param {Array<Object>} containers - Array of container objects
 * @param {Array<Object>} portainerInstances - Array of Portainer instance objects
 * @returns {Array<Object>} - Array of Portainer instance objects with containers
 */
function groupContainersByPortainerInstance(containers, portainerInstances) {
  if (!portainerInstances || portainerInstances.length === 0) {
    return [];
  }

  return portainerInstances.map((instance) => {
    const instanceContainers = containers.filter((c) => c.portainerUrl === instance.url);
    return {
      name: instance.name || new URL(instance.url).hostname,
      url: instance.url,
      id: instance.id,
      containers: instanceContainers,
      withUpdates: instanceContainers.filter((c) => c.hasUpdate === true),
      upToDate: instanceContainers.filter((c) => c.hasUpdate === false),
    };
  });
}

module.exports = {
  groupContainersByStack,
  groupContainersByStackWithUnstacked,
  groupContainersByPortainerInstance,
};

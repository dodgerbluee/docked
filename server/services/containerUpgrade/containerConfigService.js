/**
 * Container Configuration Service
 * 
 * Handles cleaning and preparing container configuration for recreation,
 * including HostConfig cleaning and NetworkingConfig preparation.
 * Extracted from containerUpgradeService to improve modularity.
 */

const logger = require("../../utils/logger");

/**
 * Clean HostConfig - remove container-specific references and invalid fields
 * @param {Object} hostConfig - Original HostConfig from container details
 * @param {string} containerName - Container name for logging
 * @returns {Object} - Cleaned HostConfig ready for container creation
 */
function cleanHostConfig(hostConfig, containerName) {
  const cleanHostConfig = { ...hostConfig };
  
  // Remove container-specific file paths
  delete cleanHostConfig.ContainerIDFile;
  // Remove Docker-managed paths that contain old container IDs
  delete cleanHostConfig.ResolvConfPath;
  delete cleanHostConfig.HostnamePath;
  delete cleanHostConfig.HostsPath;
  // Remove fields that shouldn't be in create request
  delete cleanHostConfig.Runtime;
  delete cleanHostConfig.RestartCount;
  delete cleanHostConfig.AutoRemove;

  // CRITICAL: When using network_mode: service:* or container:*, Docker doesn't allow PortBindings
  // Both modes share the network stack with another container, so ports cannot be exposed
  // This matches what Portainer does - filter out conflicting fields
  const networkMode = cleanHostConfig.NetworkMode || "";
  const isSharedNetworkMode =
    networkMode && (networkMode.startsWith("service:") || networkMode.startsWith("container:"));
  
  if (isSharedNetworkMode) {
    // Remove port bindings - they conflict with shared network modes
    // Ports are exposed on the service/container being shared, not this one
    if (cleanHostConfig.PortBindings) {
      logger.info("Removing PortBindings (conflicts with shared network mode)", {
        module: "containerUpgradeService",
        operation: "cleanHostConfig",
        containerName: containerName,
        networkMode: networkMode,
      });
      delete cleanHostConfig.PortBindings;
    }
    if (cleanHostConfig.PublishAllPorts !== undefined) {
      delete cleanHostConfig.PublishAllPorts;
    }
  }

  // Ensure RestartPolicy is valid
  if (cleanHostConfig.RestartPolicy && typeof cleanHostConfig.RestartPolicy === "object") {
    // Keep restart policy but ensure it's valid
    if (!cleanHostConfig.RestartPolicy.Name) {
      cleanHostConfig.RestartPolicy = { Name: "no" };
    }
  }

  return { cleanHostConfig, isSharedNetworkMode };
}

/**
 * Prepare NetworkingConfig from container details
 * Docker API expects specific format, and containers using network_mode: service:* or container:*
 * don't have their own network config
 * @param {Object} containerDetails - Full container details from Docker API
 * @param {boolean} isSharedNetworkMode - Whether container uses shared network mode
 * @returns {Object|undefined} - NetworkingConfig ready for container creation, or undefined
 */
function prepareNetworkingConfig(containerDetails, isSharedNetworkMode) {
  // Clean NetworkingConfig - Docker API expects specific format
  // BUT: Containers using network_mode: service:* or container:* don't have their own network config
  let networkingConfig = undefined;

  if (!isSharedNetworkMode && containerDetails.NetworkSettings?.Networks) {
    const networks = containerDetails.NetworkSettings.Networks;
    // Convert network settings to the format Docker API expects
    const endpointsConfig = {};
    for (const [networkName, networkData] of Object.entries(networks)) {
      if (networkData && typeof networkData === "object") {
        endpointsConfig[networkName] = {
          IPAMConfig: networkData.IPAMConfig || undefined,
          Links: networkData.Links || undefined,
          Aliases: networkData.Aliases || undefined,
        };
        // Remove empty objects
        if (!endpointsConfig[networkName].IPAMConfig) {
          delete endpointsConfig[networkName].IPAMConfig;
        }
        if (!endpointsConfig[networkName].Links) {
          delete endpointsConfig[networkName].Links;
        }
        if (!endpointsConfig[networkName].Aliases) {
          delete endpointsConfig[networkName].Aliases;
        }
        // If all fields are empty, remove the network entry
        if (Object.keys(endpointsConfig[networkName]).length === 0) {
          delete endpointsConfig[networkName];
        }
      }
    }
    if (Object.keys(endpointsConfig).length > 0) {
      networkingConfig = { EndpointsConfig: endpointsConfig };
    }
  }
  // If using shared network mode (service:* or container:*), networkingConfig stays undefined (correct behavior)

  return networkingConfig;
}

/**
 * Build container configuration for creation
 * @param {Object} containerDetails - Full container details from Docker API
 * @param {string} newImageName - New image name to use
 * @param {Object} cleanHostConfig - Cleaned HostConfig
 * @param {Object|undefined} networkingConfig - NetworkingConfig or undefined
 * @param {boolean} isSharedNetworkMode - Whether container uses shared network mode
 * @returns {Object} - Container configuration ready for Docker API createContainer call
 */
function buildContainerConfig(containerDetails, newImageName, cleanHostConfig, networkingConfig, isSharedNetworkMode) {
  // Build container config, only including defined values
  const containerConfig = {
    Image: newImageName,
  };

  // Add optional fields only if they exist and are valid
  if (containerDetails.Config.Cmd) {
    containerConfig.Cmd = containerDetails.Config.Cmd;
  }
  if (containerDetails.Config.Env && Array.isArray(containerDetails.Config.Env)) {
    containerConfig.Env = containerDetails.Config.Env;
  }
  // CRITICAL: ExposedPorts conflict with shared network modes (service:* or container:*)
  // Only include ExposedPorts if not using a shared network mode
  if (
    !isSharedNetworkMode &&
    containerDetails.Config.ExposedPorts &&
    Object.keys(containerDetails.Config.ExposedPorts).length > 0
  ) {
    containerConfig.ExposedPorts = containerDetails.Config.ExposedPorts;
  }
  if (cleanHostConfig && Object.keys(cleanHostConfig).length > 0) {
    containerConfig.HostConfig = cleanHostConfig;
  }
  if (containerDetails.Config.Labels && Object.keys(containerDetails.Config.Labels).length > 0) {
    containerConfig.Labels = containerDetails.Config.Labels;
  }
  if (containerDetails.Config.WorkingDir) {
    containerConfig.WorkingDir = containerDetails.Config.WorkingDir;
  }
  if (containerDetails.Config.Entrypoint) {
    containerConfig.Entrypoint = containerDetails.Config.Entrypoint;
  }
  if (networkingConfig) {
    containerConfig.NetworkingConfig = networkingConfig;
  }

  return containerConfig;
}

/**
 * Prepare container configuration for recreation
 * This is the main entry point that orchestrates all configuration preparation steps
 * @param {Object} containerDetails - Full container details from Docker API
 * @param {string} newImageName - New image name to use
 * @param {string} containerName - Container name for logging
 * @returns {Object} - Object containing containerConfig, isSharedNetworkMode, and stackName
 */
function prepareContainerConfig(containerDetails, newImageName, containerName) {
  // Extract stack name if container is part of a stack
  const labels = containerDetails.Config.Labels || {};
  const stackName =
    labels["com.docker.compose.project"] || labels["com.docker.stack.namespace"] || null;

  // Clean HostConfig
  const hostConfigResult = cleanHostConfig(
    containerDetails.HostConfig,
    containerName
  );
  const { cleanHostConfig, isSharedNetworkMode } = hostConfigResult;

  // Prepare NetworkingConfig
  const networkingConfig = prepareNetworkingConfig(containerDetails, isSharedNetworkMode);

  // Build container configuration
  const containerConfig = buildContainerConfig(
    containerDetails,
    newImageName,
    cleanHostConfig,
    networkingConfig,
    isSharedNetworkMode
  );

  return {
    containerConfig,
    isSharedNetworkMode,
    stackName,
  };
}

module.exports = {
  cleanHostConfig,
  prepareNetworkingConfig,
  buildContainerConfig,
  prepareContainerConfig,
};


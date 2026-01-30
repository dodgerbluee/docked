/**
 * Utility functions for processing and categorizing container data
 */

/**
 * Categorizes container data into structured sections
 * @param {Object} containerData - Raw container data
 * @returns {Object|null} Categorized data or null if no data
 */
export const categorizeContainerData = (containerData) => {
  if (!containerData) return null;

  // Portainer Instance details
  const portainerInstance = {
    name: containerData.portainerName,
    url: containerData.portainerUrl,
    endpointId: containerData.endpointId,
  };

  // Container details (includes name, stackName, and runtime state)
  const containerDetails = {
    name: containerData.name,
    stackName: containerData.stackName,
    id: containerData.id,
    status: containerData.status,
    state: containerData.state,
    usesNetworkMode: containerData.usesNetworkMode,
    providesNetwork: containerData.providesNetwork,
  };

  // Portainer image details
  const portainerImageDetails = {
    image: containerData.image,
    currentImageCreated: containerData.currentImageCreated,
  };

  // Portainer version details
  const portainerVersionDetails = {
    currentDigest: containerData.currentDigest,
    currentTag: containerData.currentTag,
    currentVersion: containerData.currentVersion,
    currentDigestFull: containerData.currentDigestFull,
    currentVersionPublishDate: containerData.currentVersionPublishDate,
  };

  // Docker Hub image details
  const dockerHubImageDetails = {
    imageRepo: containerData.imageRepo,
    existsInDockerHub: containerData.existsInDockerHub,
  };

  // Docker Hub version details
  const dockerHubVersionDetails = {
    latestDigest: containerData.latestDigest,
    latestTag: containerData.latestTag,
    newVersion: containerData.newVersion,
    latestDigestFull: containerData.latestDigestFull,
    latestPublishDate: containerData.latestPublishDate,
    hasUpdate: containerData.hasUpdate,
  };

  return {
    portainerInstance,
    containerDetails,
    portainerImageDetails,
    portainerVersionDetails,
    dockerHubImageDetails,
    dockerHubVersionDetails,
  };
};

/**
 * Builds structured data object from categorized data
 * @param {Object} categorized - Categorized container data
 * @param {Object} containerData - Raw container data (fallback)
 * @returns {Object} Structured data object
 */
export const buildStructuredData = (categorized, containerData) => {
  if (!categorized) {
    return containerData;
  }

  const structuredData = {};

  // Always include Portainer Data section if we have container data
  const hasPortainerInstance = Object.keys(categorized.portainerInstance).some(
    (key) => categorized.portainerInstance[key] != null
  );
  const hasContainerDetails = Object.keys(categorized.containerDetails).some(
    (key) => categorized.containerDetails[key] != null
  );
  const hasPortainerImageDetails = Object.keys(categorized.portainerImageDetails).some(
    (key) => categorized.portainerImageDetails[key] != null
  );
  const hasPortainerVersionDetails = Object.keys(categorized.portainerVersionDetails).some(
    (key) => categorized.portainerVersionDetails[key] != null
  );

  const hasPortainerData =
    hasPortainerInstance ||
    hasContainerDetails ||
    hasPortainerImageDetails ||
    hasPortainerVersionDetails;

  if (hasPortainerData) {
    structuredData.portainerData = {};

    if (hasPortainerInstance) {
      structuredData.portainerData.portainerInstance = categorized.portainerInstance;
    }

    if (hasContainerDetails) {
      structuredData.portainerData.containerDetails = categorized.containerDetails;
    }

    if (hasPortainerImageDetails || hasPortainerVersionDetails) {
      structuredData.portainerData.imageDetails = {};

      if (hasPortainerImageDetails) {
        Object.assign(structuredData.portainerData.imageDetails, categorized.portainerImageDetails);
      }

      if (hasPortainerVersionDetails) {
        structuredData.portainerData.imageDetails.versionDetails =
          categorized.portainerVersionDetails;
      }
    }
  }

  // Docker Hub Data section (optional - only if data exists)
  const hasDockerHubImageDetails = Object.keys(categorized.dockerHubImageDetails).some(
    (key) => categorized.dockerHubImageDetails[key] != null
  );
  const hasDockerHubVersionDetails = Object.keys(categorized.dockerHubVersionDetails).some(
    (key) => categorized.dockerHubVersionDetails[key] != null
  );
  const hasDockerHubData = hasDockerHubImageDetails || hasDockerHubVersionDetails;

  if (hasDockerHubData) {
    structuredData.dockerHubData = {};

    if (hasDockerHubImageDetails) {
      structuredData.dockerHubData.imageDetails = categorized.dockerHubImageDetails;
    }

    if (hasDockerHubVersionDetails) {
      structuredData.dockerHubData.versionDetails = categorized.dockerHubVersionDetails;
    }
  }

  // Always display structured data if we have any data at all
  // If structuredData is empty, fall back to raw containerData
  const hasAnyData = Object.keys(structuredData).length > 0;

  return hasAnyData ? structuredData : containerData;
};

/**
 * Formats a date string to a readable format
 * @param {string} dateString - Date string to format
 * @returns {string} Formatted date string
 */
export const formatDate = (dateString) => {
  if (!dateString) return "Unknown";
  try {
    return new Date(dateString).toLocaleString();
  } catch (_e) {
    return dateString;
  }
};

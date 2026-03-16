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

  // Source Instance details
  const sourceInstance = {
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

  // Source image details
  const sourceImageDetails = {
    image: containerData.image,
    currentImageCreated: containerData.currentImageCreated,
  };

  // Source version details
  const sourceVersionDetails = {
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
    sourceInstance,
    containerDetails,
    sourceImageDetails,
    sourceVersionDetails,
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

  // Always include Source Data section if we have container data
  const hasSourceInstance = Object.keys(categorized.sourceInstance).some(
    (key) => categorized.sourceInstance[key] != null
  );
  const hasContainerDetails = Object.keys(categorized.containerDetails).some(
    (key) => categorized.containerDetails[key] != null
  );
  const hasSourceImageDetails = Object.keys(categorized.sourceImageDetails).some(
    (key) => categorized.sourceImageDetails[key] != null
  );
  const hasSourceVersionDetails = Object.keys(categorized.sourceVersionDetails).some(
    (key) => categorized.sourceVersionDetails[key] != null
  );

  const hasSourceData =
    hasSourceInstance ||
    hasContainerDetails ||
    hasSourceImageDetails ||
    hasSourceVersionDetails;

  if (hasSourceData) {
    structuredData.sourceData = {};

    if (hasSourceInstance) {
      structuredData.sourceData.sourceInstance = categorized.sourceInstance;
    }

    if (hasContainerDetails) {
      structuredData.sourceData.containerDetails = categorized.containerDetails;
    }

    if (hasSourceImageDetails || hasSourceVersionDetails) {
      structuredData.sourceData.imageDetails = {};

      if (hasSourceImageDetails) {
        Object.assign(structuredData.sourceData.imageDetails, categorized.sourceImageDetails);
      }

      if (hasSourceVersionDetails) {
        structuredData.sourceData.imageDetails.versionDetails =
          categorized.sourceVersionDetails;
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
  } catch {
    return dateString;
  }
};

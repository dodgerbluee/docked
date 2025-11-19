import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw, ChevronRight, ChevronDown } from "lucide-react";
import axios from "axios";
import { API_BASE_URL } from "../../utils/api";
import Button from "../ui/Button";
import Card from "../ui/Card";
import Alert from "../ui/Alert";
import { CardSkeleton } from "../ui/LoadingSkeleton";
import styles from "./DataTab.module.css";

/**
 * DataTab Component
 * Displays container data from database with expandable JSON view (developer mode only)
 */
function DataTab() {
  const [dataEntries, setDataEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedContainers, setExpandedContainers] = useState(new Set());
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);
  const [checkingDeveloperMode, setCheckingDeveloperMode] = useState(true);

  // Check if developer mode is enabled
  useEffect(() => {
    const checkDeveloperMode = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/settings/refreshing-toggles-enabled`);
        if (response.data.success) {
          setDeveloperModeEnabled(response.data.enabled || false);
        }
      } catch (err) {
        console.error("Error checking developer mode:", err);
        setDeveloperModeEnabled(false);
      } finally {
        setCheckingDeveloperMode(false);
      }
    };
    checkDeveloperMode();
  }, []);

  const fetchContainerData = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);

      const response = await axios.get(`${API_BASE_URL}/api/containers/data`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
      });

      if (response.data.success) {
        const entries = response.data.entries || [];
        console.log("Container data entries received:", entries);
        console.log("Entry count:", entries.length);
        entries.forEach((entry, idx) => {
          console.log(`Entry ${idx}:`, {
            key: entry.key,
            containerCount: entry.containerCount,
            containerNames: entry.containerNames,
            hasData: !!entry.data,
            containersLength: entry.data?.containers?.length || 0,
          });
        });
        setDataEntries(entries);
      } else {
        setError(response.data.error || "Failed to fetch container data");
      }
    } catch (err) {
      console.error("Error fetching container data:", err);
      const errorMessage = err.response?.data?.error || err.message || "Failed to fetch container data";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContainerData();
  }, [fetchContainerData]);

  const toggleContainerExpansion = (entryKey, containerName) => {
    const containerKey = `${entryKey}:${containerName}`;
    setExpandedContainers((prev) => {
      const next = new Set(prev);
      if (next.has(containerKey)) {
        next.delete(containerKey);
      } else {
        next.add(containerKey);
      }
      return next;
    });
  };

  const expandAllContainers = useCallback(() => {
    const allContainerKeys = new Set();
    dataEntries.forEach((entry) => {
      const containerNames = entry.containerNames || [];
      const containers = entry.data?.containers || [];
      const containersToDisplay = containerNames.length > 0 
        ? containerNames
        : containers.map((c) => c.name || c.id || `Container`);
      containersToDisplay.forEach((name) => {
        const containerKey = `${entry.key}:${name}`;
        allContainerKeys.add(containerKey);
      });
    });
    setExpandedContainers(allContainerKeys);
  }, [dataEntries]);

  const collapseAllContainers = useCallback(() => {
    setExpandedContainers(new Set());
  }, []);

  // Check if all containers are expanded
  const areAllExpanded = useCallback(() => {
    if (dataEntries.length === 0) return false;
    let totalContainers = 0;
    let expandedCount = 0;
    dataEntries.forEach((entry) => {
      const containerNames = entry.containerNames || [];
      const containers = entry.data?.containers || [];
      const containersToDisplay = containerNames.length > 0 
        ? containerNames
        : containers.map((c) => c.name || c.id || `Container`);
      containersToDisplay.forEach((name) => {
        totalContainers++;
        const containerKey = `${entry.key}:${name}`;
        if (expandedContainers.has(containerKey)) {
          expandedCount++;
        }
      });
    });
    return totalContainers > 0 && expandedCount === totalContainers;
  }, [dataEntries, expandedContainers]);

  const renderStructuredData = (categorized, containerData) => {
    if (!categorized) {
      return (
        <div className={styles.containerData}>
          <div className={styles.dataHeader}>Container Data (JSON)</div>
          <pre className={styles.dataContent}>
            {JSON.stringify(containerData, null, 2)}
          </pre>
        </div>
      );
    }

    // Build the structured data object
    const structuredData = {};

    // Always include Portainer Data section if we have container data
    // Check if we have any meaningful Portainer data
    const hasPortainerInstance = Object.keys(categorized.portainerInstance).some(key => categorized.portainerInstance[key] != null);
    const hasContainerDetails = Object.keys(categorized.containerDetails).some(key => categorized.containerDetails[key] != null);
    const hasPortainerImageDetails = Object.keys(categorized.portainerImageDetails).some(key => categorized.portainerImageDetails[key] != null);
    const hasPortainerVersionDetails = Object.keys(categorized.portainerVersionDetails).some(key => categorized.portainerVersionDetails[key] != null);
    
    const hasPortainerData = hasPortainerInstance || hasContainerDetails || hasPortainerImageDetails || hasPortainerVersionDetails;

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
          structuredData.portainerData.imageDetails.versionDetails = categorized.portainerVersionDetails;
        }
      }
    }

    // Docker Hub Data section (optional - only if data exists)
    const hasDockerHubImageDetails = Object.keys(categorized.dockerHubImageDetails).some(key => categorized.dockerHubImageDetails[key] != null);
    const hasDockerHubVersionDetails = Object.keys(categorized.dockerHubVersionDetails).some(key => categorized.dockerHubVersionDetails[key] != null);
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

    return (
      <div className={styles.containerData}>
        <pre className={styles.dataContent}>
          {hasAnyData 
            ? JSON.stringify(structuredData, null, 2)
            : JSON.stringify(containerData, null, 2)}
        </pre>
      </div>
    );
  };

  const categorizeContainerData = (containerData) => {
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

  const formatDate = (dateString) => {
    if (!dateString) return "Unknown";
    try {
      return new Date(dateString).toLocaleString();
    } catch (e) {
      return dateString;
    }
  };

  if (checkingDeveloperMode || loading) {
    return (
      <div className={styles.dataTab}>
        <CardSkeleton />
      </div>
    );
  }

  // If developer mode is not enabled, show message
  if (!developerModeEnabled) {
    return (
      <div className={styles.dataTab}>
        <Card>
          <Alert variant="warning">
            Data viewer is only available when Developer Mode is enabled. Enable it in General Settings.
          </Alert>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.dataTab}>
      <Card>
        <div className={styles.headerWrapper}>
          <div className={styles.header}>
            <div className={styles.headerTitle}>
              <h3 className={styles.title}>Portainer Data</h3>
              {dataEntries.length > 0 && dataEntries[0] && (
                <div className={styles.lastPulledInfo}>
                  {dataEntries[0].lastPortainerPull && (
                    <span className={styles.lastPulled}>
                      Last Portainer pull: {formatDate(dataEntries[0].lastPortainerPull)}
                    </span>
                  )}
                  {dataEntries[0].lastDockerHubPull && (
                    <span className={styles.lastPulled}>
                      Last Docker Hub pull: {formatDate(dataEntries[0].lastDockerHubPull)}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className={styles.actions}>
              {dataEntries.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (areAllExpanded()) {
                      collapseAllContainers();
                    } else {
                      expandAllContainers();
                    }
                  }}
                  size="sm"
                >
                  {areAllExpanded() ? "Collapse All" : "Expand All"}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={fetchContainerData}
                icon={RefreshCw}
                iconPosition="left"
                size="sm"
              >
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <Alert variant="error" className={styles.error}>
            {error}
          </Alert>
        )}

        <div className={styles.content}>
          {dataEntries.length > 0 ? (
            <div className={styles.dataWrapper}>
              {dataEntries.map((entry, entryIdx) => {
                const hasData = entry.data && !entry.error;
                const containerNames = entry.containerNames || [];
                const containers = entry.data?.containers || [];
                
                console.log(`Processing entry ${entryIdx}:`, {
                  key: entry.key,
                  hasData,
                  containerNamesLength: containerNames.length,
                  containersLength: containers.length,
                  containerNames,
                  containers: containers.map(c => ({ name: c.name, id: c.id })),
                  instanceName: entry.data?.instanceName,
                  instanceUrl: entry.data?.instanceUrl,
                });

                // Display containers if we have container names OR if we have containers in the data
                const hasContainers = containerNames.length > 0 || containers.length > 0;
                
                // Check if we have Portainer instance data (instanceName, instanceUrl) even without containers
                const hasPortainerInstanceData = entry.data?.instanceName || entry.data?.instanceUrl;
                
                // If we have data but no containers, show all available data in a structured format
                if (hasData && !hasContainers) {
                  // Build complete data structure showing all available information
                  const completeData = {
                    dataEntry: {
                      key: entry.key,
                      containerCount: entry.containerCount || 0,
                      updatedAt: entry.updatedAt || null,
                      createdAt: entry.createdAt || null,
                    },
                    portainerData: {},
                  };
                  
                  // Add Portainer instance data if available
                  if (hasPortainerInstanceData) {
                    completeData.portainerData.portainerInstance = {
                      name: entry.data.instanceName || null,
                      url: entry.data.instanceUrl || null,
                    };
                  }
                  
                  // Include any other data from entry.data that might be useful
                  const otherData = { ...entry.data };
                  delete otherData.instanceName;
                  delete otherData.instanceUrl;
                  delete otherData.containers;
                  
                  if (Object.keys(otherData).length > 0) {
                    completeData.portainerData.other = otherData;
                  }
                  
                  // If we have Portainer instance data, show structured format
                  if (hasPortainerInstanceData) {
                    return (
                      <div key={entry.key} className={styles.dataEntry}>
                        <div className={styles.dataSection}>
                          <div className={styles.dataHeader}>Data Entry: {entry.key}</div>
                          <Alert variant="info" style={{ marginBottom: "12px" }}>
                            No containers found in this data entry. Showing all available Portainer instance data.
                          </Alert>
                          <pre className={styles.dataContent}>
                            {JSON.stringify(completeData, null, 2)}
                          </pre>
                        </div>
                      </div>
                    );
                  }
                  
                  // Fallback: show raw data if no structured Portainer data
                  return (
                    <div key={entry.key} className={styles.dataEntry}>
                      <div className={styles.dataSection}>
                        <div className={styles.dataHeader}>Data Entry: {entry.key}</div>
                        <Alert variant="info" style={{ marginBottom: "12px" }}>
                          No containers found in this data entry. Showing raw data.
                        </Alert>
                        <pre className={styles.dataContent}>
                          {JSON.stringify(entry.data, null, 2)}
                        </pre>
                      </div>
                    </div>
                  );
                }
                
                if (hasData && hasContainers) {
                  // Use containerNames if available, otherwise use containers directly
                  const containersToDisplay = containerNames.length > 0 
                    ? containerNames.map((name, idx) => ({ name, idx }))
                    : containers.map((c, idx) => ({ name: c.name || c.id || `Container ${idx + 1}`, idx }));
                  
                  return containersToDisplay.map(({ name, idx }) => {
                    const containerKey = `${entry.key}:${name}`;
                    const isContainerExpanded = expandedContainers.has(containerKey);
                    // Try multiple ways to find the container data
                    const containerData = containers.find(
                      (c) => {
                        const cName = c.name || "";
                        const cId = c.id || "";
                        // Match by name (with or without leading slash)
                        return cName === name || 
                               cName.replace("/", "") === name || 
                               cName === name.replace("/", "") ||
                               // Match by ID (full or short)
                               cId === name ||
                               cId.substring(0, 12) === name ||
                               name.substring(0, 12) === cId.substring(0, 12);
                      }
                    ) || containers[idx]; // Fallback to index-based lookup

                    return (
                      <div key={`${entry.key}-${idx}`} className={styles.containerItem}>
                        <div
                          className={styles.containerLine}
                          onClick={() => toggleContainerExpansion(entry.key, name)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleContainerExpansion(entry.key, name);
                            }
                          }}
                        >
                          <span className={styles.expandIcon}>
                            {isContainerExpanded ? (
                              <ChevronDown size={16} />
                            ) : (
                              <ChevronRight size={16} />
                            )}
                          </span>
                          <span className={styles.containerName}>{name}</span>
                          <span className={styles.expandHint}>
                            {isContainerExpanded ? " (click to collapse)" : " (click to expand)"}
                          </span>
                        </div>
                        {isContainerExpanded && (() => {
                          // If no containerData found, show a message or try to find it differently
                          if (!containerData) {
                            // Try to find by index as fallback
                            const containerByIndex = entry.data?.containers?.[idx];
                            if (containerByIndex) {
                              const categorized = categorizeContainerData(containerByIndex);
                              return renderStructuredData(categorized || containerByIndex, containerByIndex);
                            }
                            return (
                              <div className={styles.containerData}>
                                <Alert variant="warning">
                                  Container data not found for "{name}". Showing raw data entry.
                                </Alert>
                                <pre className={styles.dataContent}>
                                  {JSON.stringify(entry.data, null, 2)}
                                </pre>
                              </div>
                            );
                          }
                          
                          const categorized = categorizeContainerData(containerData);
                          return renderStructuredData(categorized || containerData, containerData);
                        })()}
                      </div>
                    );
                  });
                }

                // Final fallback: if we have any data at all, show it
                // This ensures we always display something if data exists
                if (hasData) {
                  // Build complete data structure
                  const completeData = {
                    dataEntry: {
                      key: entry.key,
                      containerCount: entry.containerCount || 0,
                      updatedAt: entry.updatedAt || null,
                      createdAt: entry.createdAt || null,
                    },
                    portainerData: {},
                  };
                  
                  // Check if we have Portainer instance data
                  const hasPortainerInstanceData = entry.data?.instanceName || entry.data?.instanceUrl;
                  
                  if (hasPortainerInstanceData) {
                    completeData.portainerData.portainerInstance = {
                      name: entry.data.instanceName || null,
                      url: entry.data.instanceUrl || null,
                    };
                  }
                  
                  // Include any other data from entry.data
                  const otherData = { ...entry.data };
                  delete otherData.instanceName;
                  delete otherData.instanceUrl;
                  delete otherData.containers;
                  
                  if (Object.keys(otherData).length > 0) {
                    completeData.portainerData.other = otherData;
                  }
                  
                  if (hasPortainerInstanceData || Object.keys(completeData.portainerData).length > 0) {
                    return (
                      <div key={entry.key} className={styles.dataEntry}>
                        <div className={styles.dataSection}>
                          <div className={styles.dataHeader}>Data Entry: {entry.key}</div>
                          <Alert variant="info" style={{ marginBottom: "12px" }}>
                            Showing all available data for this data entry.
                          </Alert>
                          <pre className={styles.dataContent}>
                            {JSON.stringify(completeData, null, 2)}
                          </pre>
                        </div>
                      </div>
                    );
                  }
                  
                  // Last resort: show raw data
                  return (
                    <div key={entry.key} className={styles.dataEntry}>
                      <div className={styles.dataSection}>
                        <div className={styles.dataHeader}>Data Entry: {entry.key}</div>
                        <pre className={styles.dataContent}>
                          {JSON.stringify(entry.data, null, 2)}
                        </pre>
                      </div>
                    </div>
                  );
                }

                // Only return null if we truly have no data
                return null;
              })}
            </div>
          ) : (
            <div className={styles.empty}>No data entries found</div>
          )}
        </div>
      </Card>
    </div>
  );
}

DataTab.propTypes = {};

export default DataTab;


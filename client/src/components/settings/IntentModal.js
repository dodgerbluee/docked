import React, { useState, useEffect, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import { X, Search } from "lucide-react";
import axios from "axios";
import Button from "../ui/Button";
import LoadingSpinner from "../ui/LoadingSpinner";
import ErrorDisplay from "../ErrorDisplay/ErrorDisplay";
import styles from "./IntentModal.module.css";

const INTENT_TYPES = {
  STACK_SERVICE: "stack-service",
  IMAGE_REPO: "image-repo",
  CONTAINER_NAME: "container-name",
};

const IntentModal = ({ intent, containers, onClose, onSuccess, serverUrl }) => {
  const [step, setStep] = useState(intent ? 2 : 1); // Step 1: Select container, Step 2: Create intent
  const [selectedContainer, setSelectedContainer] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [intentType, setIntentType] = useState(INTENT_TYPES.STACK_SERVICE);
  const [description, setDescription] = useState("");
  const [stackName, setStackName] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [imageRepo, setImageRepo] = useState("");
  const [containerName, setContainerName] = useState("");
  const [matchPreview, setMatchPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Extract unique values from containers
  const stackServices = useMemo(() => {
    const stacks = new Map();
    containers.forEach((c) => {
      if (c.stackName) {
        if (!stacks.has(c.stackName)) {
          stacks.set(c.stackName, []);
        }
        // Derive service name from container name if in a stack
        // Docker Compose containers are named: stackname_servicename_1
        const serviceName = c.name && c.stackName && c.name.startsWith(c.stackName + "_")
          ? c.name.split("_").slice(1, -1).join("_") // Remove stack prefix and instance suffix
          : c.name;
        if (serviceName && !stacks.get(c.stackName).includes(serviceName)) {
          stacks.get(c.stackName).push(serviceName);
        }
      }
    });
    return stacks;
  }, [containers]);

  const imageRepos = useMemo(() => {
    const repos = new Set();
    containers.forEach((c) => {
      if (c.imageRepo) {
        repos.add(c.imageRepo);
      }
    });
    return Array.from(repos).sort();
  }, [containers]);

  const containerNames = useMemo(() => {
    const names = new Set();
    containers.forEach((c) => {
      if (c.name) {
        names.add(c.name);
      }
    });
    return Array.from(names).sort();
  }, [containers]);

  const services = useMemo(() => {
    return stackName && stackServices.has(stackName) ? stackServices.get(stackName).sort() : [];
  }, [stackName, stackServices]);

  // Helper to derive service name from container
  const getServiceName = useCallback((container) => {
    if (!container.name || !container.stackName) return null;
    if (container.name.startsWith(container.stackName + "_")) {
      return container.name.split("_").slice(1, -1).join("_");
    }
    return container.name;
  }, []);

  // Filter containers based on search query
  const filteredContainers = useMemo(() => {
    if (!searchQuery.trim()) return containers;
    const query = searchQuery.toLowerCase();
    return containers.filter((c) => {
      const serviceName = getServiceName(c);
      return (
        c.name?.toLowerCase().includes(query) ||
        c.imageRepo?.toLowerCase().includes(query) ||
        c.stackName?.toLowerCase().includes(query) ||
        serviceName?.toLowerCase().includes(query)
      );
    });
  }, [containers, searchQuery, getServiceName]);

  // Load existing intent data
  useEffect(() => {
    if (intent) {
      setDescription(intent.description || "");
      if (intent.stackName && intent.serviceName) {
        setIntentType(INTENT_TYPES.STACK_SERVICE);
        setStackName(intent.stackName);
        setServiceName(intent.serviceName);
      } else if (intent.imageRepo) {
        setIntentType(INTENT_TYPES.IMAGE_REPO);
        setImageRepo(intent.imageRepo);
      } else if (intent.containerName) {
        setIntentType(INTENT_TYPES.CONTAINER_NAME);
        setContainerName(intent.containerName);
      }
    }
  }, [intent]);

  const handleContainerSelect = useCallback((container) => {
    setSelectedContainer(container);
    // Pre-fill values based on container
    const derivedServiceName = getServiceName(container);
    setStackName(container.stackName || "");
    setServiceName(derivedServiceName || "");
    setImageRepo(container.imageRepo || "");
    setContainerName(container.name || "");

    // Auto-select best intent type based on what's available
    if (container.stackName && derivedServiceName) {
      setIntentType(INTENT_TYPES.STACK_SERVICE);
    } else if (container.imageRepo) {
      setIntentType(INTENT_TYPES.IMAGE_REPO);
    } else {
      setIntentType(INTENT_TYPES.CONTAINER_NAME);
    }

    setStep(2);
  }, [getServiceName]);

  // Auto-preview on mount and when values change
  useEffect(() => {
    previewMatch();
  }, [intentType, stackName, serviceName, imageRepo, containerName]);

  const previewMatch = useCallback(async () => {
    if (!intent?.id) return; // Only preview for existing intents

    try {
      setPreviewLoading(true);
      const response = await axios.post(
        `${serverUrl}/api/auto-update/intents/${intent.id}/test-match`,
        {},
        { withCredentials: true }
      );
      setMatchPreview(response.data);
    } catch (err) {
      console.error("Error previewing match:", err);
    } finally {
      setPreviewLoading(false);
    }
  }, [intent?.id, serverUrl]);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();

      // Validate that at least one criterion is selected
      if (
        !stackName &&
        !serviceName &&
        !imageRepo &&
        !containerName
      ) {
        setError(new Error("Please select at least one matching criterion"));
        return;
      }

      const intentData = {
        description: description.trim(),
        stackName: intentType === INTENT_TYPES.STACK_SERVICE ? stackName : null,
        serviceName: intentType === INTENT_TYPES.STACK_SERVICE ? serviceName : null,
        imageRepo: intentType === INTENT_TYPES.IMAGE_REPO ? imageRepo : null,
        containerName: intentType === INTENT_TYPES.CONTAINER_NAME ? containerName : null,
      };

      try {
        setLoading(true);
        setError(null);

        if (intent?.id) {
          // Update existing intent
          await axios.patch(
            `${serverUrl}/api/auto-update/intents/${intent.id}`,
            intentData,
            { withCredentials: true }
          );
        } else {
          // Create new intent
          await axios.post(
            `${serverUrl}/api/auto-update/intents`,
            intentData,
            { withCredentials: true }
          );
        }

        onSuccess();
      } catch (err) {
        console.error("Error saving intent:", err);
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [
      intentType,
      stackName,
      serviceName,
      imageRepo,
      containerName,
      description,
      intent?.id,
      serverUrl,
      onSuccess,
    ]
  );

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>{intent ? "Edit Intent" : step === 1 ? "Select Container" : "Create Auto-Update Intent"}</h2>
          <button className={styles.closeButton} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {error && <ErrorDisplay error={error} title="Error" />}

        {step === 1 ? (
          // Step 1: Container selection
          <div className={styles.containerList}>
            <div className={styles.searchBox}>
              <Search size={16} className={styles.searchIcon} />
              <input
                type="text"
                placeholder="Search containers by name, image, or stack..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={styles.searchInput}
                autoFocus
              />
            </div>

            <div className={styles.containerItems}>
              {containers.length === 0 ? (
                <div className={styles.emptyState}>
                  <p>No containers available</p>
                  <p className={styles.emptyHint}>
                    Please configure a Portainer instance above to fetch containers
                  </p>
                </div>
              ) : filteredContainers.length === 0 ? (
                <div className={styles.emptyState}>
                  <p>No containers match your search</p>
                </div>
              ) : (
                filteredContainers.map((container, idx) => {
                  const derivedServiceName = getServiceName(container);
                  return (
                    <div
                      key={idx}
                      className={styles.containerItem}
                      onClick={() => handleContainerSelect(container)}
                    >
                      <div className={styles.containerInfo}>
                        <div className={styles.containerMainInfo}>
                          <span className={styles.containerNameLabel}>{container.name}</span>
                          {container.hasUpdate && (
                            <span className={styles.updateAvailableBadge}>Update Available</span>
                          )}
                        </div>
                        <div className={styles.containerMeta}>
                          {container.stackName && derivedServiceName && (
                            <span className={styles.metaItem}>
                              📦 {container.stackName}/{derivedServiceName}
                            </span>
                          )}
                          {container.imageRepo && (
                            <span className={styles.metaItem}>🐳 {container.imageRepo}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          // Step 2: Intent creation
          <form className={styles.form} onSubmit={handleSubmit}>
            {selectedContainer && (
              <div className={styles.selectedContainer}>
                <div className={styles.selectedLabel}>Selected Container:</div>
                <div className={styles.selectedName}>{selectedContainer.name}</div>
                <button
                  type="button"
                  className={styles.changeButton}
                  onClick={() => setStep(1)}
                >
                  Change
                </button>
              </div>
            )}

            <div className={styles.formGroup}>
              <label>Description (Optional)</label>
              <input
                type="text"
                placeholder="e.g., Production Plex auto-upgrade"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={styles.input}
              />
              <p className={styles.hint}>Give this intent a meaningful name</p>
            </div>

            <div className={styles.formGroup}>
              <label>Intent Type</label>
              <div className={styles.intentTypeButtons}>
                <button
                  type="button"
                  className={`${styles.typeButton} ${
                    intentType === INTENT_TYPES.STACK_SERVICE ? styles.active : ""
                  }`}
                  onClick={() => setIntentType(INTENT_TYPES.STACK_SERVICE)}
                  disabled={!stackName || !serviceName}
                >
                  <div className={styles.typeButtonTitle}>Stack + Service</div>
                  {stackName && serviceName && (
                    <div className={styles.typeButtonValue}>
                      {stackName}/{serviceName}
                    </div>
                  )}
                </button>
                <button
                  type="button"
                  className={`${styles.typeButton} ${
                    intentType === INTENT_TYPES.IMAGE_REPO ? styles.active : ""
                  }`}
                  onClick={() => setIntentType(INTENT_TYPES.IMAGE_REPO)}
                  disabled={!imageRepo}
                >
                  <div className={styles.typeButtonTitle}>Image Repository</div>
                  {imageRepo && <div className={styles.typeButtonValue}>{imageRepo}</div>}
                </button>
                <button
                  type="button"
                  className={`${styles.typeButton} ${
                    intentType === INTENT_TYPES.CONTAINER_NAME ? styles.active : ""
                  }`}
                  onClick={() => setIntentType(INTENT_TYPES.CONTAINER_NAME)}
                  disabled={!containerName}
                >
                  <div className={styles.typeButtonTitle}>Container Name</div>
                  {containerName && <div className={styles.typeButtonValue}>{containerName}</div>}
                </button>
              </div>
              <p className={styles.hint}>
                Choose how to match containers for auto-updates
              </p>
            </div>

            {intent && matchPreview && (
              <div className={styles.preview}>
                <h4>Match Preview</h4>
                {previewLoading ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <div className={styles.previewContent}>
                    <p className={styles.previewStat}>
                      <strong>{matchPreview.matchedCount || 0}</strong> container
                      {matchPreview.matchedCount !== 1 ? "s" : ""} match this criteria
                    </p>
                    {matchPreview.withUpdatesCount > 0 && (
                      <p className={styles.previewHighlight}>
                        <strong>{matchPreview.withUpdatesCount}</strong> have updates available
                      </p>
                    )}
                    {matchPreview.matchedContainers && matchPreview.matchedContainers.length > 0 && (
                      <div className={styles.matchedList}>
                        {matchPreview.matchedContainers.map((container, idx) => (
                          <div key={idx} className={styles.matchedItem}>
                            <span className={styles.containerName}>{container.name}</span>
                            {container.hasUpdate && (
                              <span className={styles.updateBadge}>Update available</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => setStep(1)} disabled={loading}>
                Back
              </Button>
              <Button variant="primary" type="submit" disabled={loading}>
                {intent ? "Update Intent" : "Create Intent"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

IntentModal.propTypes = {
  intent: PropTypes.object,
  containers: PropTypes.arrayOf(PropTypes.object).isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func.isRequired,
  serverUrl: PropTypes.string.isRequired,
};

export default IntentModal;

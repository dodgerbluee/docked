import React, { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Plus, Edit2, Trash2, CheckCircle, Circle } from "lucide-react";
import axios from "axios";
import Card from "../ui/Card";
import Button from "../ui/Button";
import LoadingSpinner from "../ui/LoadingSpinner";
import ErrorDisplay from "../ErrorDisplay/ErrorDisplay";
import IntentModal from "./IntentModal";
import styles from "./AutoUpdateIntentsTab.module.css";

const AutoUpdateIntentsTab = ({ portainerInstances = [] }) => {
  const [intents, setIntents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingIntent, setEditingIntent] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [containers, setContainers] = useState([]);
  const [containerLoading, setContainerLoading] = useState(false);

  const serverUrl = process.env.REACT_APP_SERVER || "http://localhost:3000";

  // Fetch intents on mount
  useEffect(() => {
    fetchIntents();
    fetchContainers();
  }, []);

  const fetchIntents = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${serverUrl}/api/auto-update/intents`, {
        withCredentials: true,
      });
      setIntents(response.data.intents || []);
      setError(null);
    } catch (err) {
      console.error("Error fetching intents:", err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [serverUrl]);

  const fetchContainers = useCallback(async () => {
    try {
      setContainerLoading(true);
      const response = await axios.get(`${serverUrl}/api/containers`, {
        withCredentials: true,
      });
      console.log("Containers response:", response.data);
      const containerData = response.data.containers || response.data || [];
      setContainers(Array.isArray(containerData) ? containerData : []);
      console.log("Containers loaded:", containerData.length, "containers");
    } catch (err) {
      console.error("Error fetching containers:", err);
      setContainers([]);
    } finally {
      setContainerLoading(false);
    }
  }, [serverUrl]);

  const handleAddIntent = useCallback(() => {
    setEditingIntent(null);
    setShowModal(true);
  }, []);

  const handleEditIntent = useCallback((intent) => {
    setEditingIntent(intent);
    setShowModal(true);
  }, []);

  const handleDeleteIntent = useCallback(async (intentId) => {
    if (!window.confirm("Are you sure you want to delete this intent?")) {
      return;
    }

    try {
      setDeleting(intentId);
      await axios.delete(`${serverUrl}/api/auto-update/intents/${intentId}`, {
        withCredentials: true,
      });
      setIntents((prev) => prev.filter((i) => i.id !== intentId));
      setError(null);
    } catch (err) {
      console.error("Error deleting intent:", err);
      setError(err);
    } finally {
      setDeleting(null);
    }
  }, [serverUrl]);

  const handleToggleIntent = useCallback(
    async (intentId, currentlyEnabled) => {
      try {
        const endpoint = currentlyEnabled ? "disable" : "enable";
        await axios.post(`${serverUrl}/api/auto-update/intents/${intentId}/${endpoint}`, {}, {
          withCredentials: true,
        });
        setIntents((prev) =>
          prev.map((i) => (i.id === intentId ? { ...i, enabled: !i.enabled } : i))
        );
      } catch (err) {
        console.error("Error toggling intent:", err);
        setError(err);
      }
    },
    [serverUrl]
  );

  const handleModalSuccess = useCallback(() => {
    setShowModal(false);
    setEditingIntent(null);
    fetchIntents();
  }, [fetchIntents]);

  const getIntentDescription = (intent) => {
    if (intent.stackName && intent.serviceName) {
      return `${intent.stackName}/${intent.serviceName}`;
    }
    if (intent.imageRepo) {
      return intent.imageRepo;
    }
    if (intent.containerName) {
      return intent.containerName;
    }
    return "Unknown";
  };

  const getIntentType = (intent) => {
    if (intent.stackName && intent.serviceName) return "Stack/Service";
    if (intent.imageRepo) return "Image";
    if (intent.containerName) return "Container";
    return "Unknown";
  };

  if (loading) {
    return <LoadingSpinner size="md" message="Loading intents..." />;
  }

  return (
    <div className={styles.intentsContainer}>
      <div className={styles.header}>
        <div>
          <h2>Auto-Update Intents</h2>
          <p className={styles.subtitle}>
            Manage automatic container updates based on your criteria
          </p>
        </div>
        <Button
          onClick={handleAddIntent}
          variant="primary"
          icon={Plus}
          disabled={containerLoading || containers.length === 0 || portainerInstances.length === 0}
        >
          {containerLoading ? "Loading containers..." : "Add Intent"}
        </Button>
      </div>

      {error && <ErrorDisplay error={error} title="Error loading intents" />}

      {portainerInstances.length === 0 ? (
        <Card className={styles.emptyState}>
          <div className={styles.emptyContent}>
            <p>No Portainer Instances Configured</p>
            <p className={styles.emptySubtext}>
              Please add a Portainer instance above to start managing auto-update intents.
            </p>
          </div>
        </Card>
      ) : containers.length === 0 ? (
        <Card className={styles.emptyState}>
          <div className={styles.emptyContent}>
            <p>No Containers Found</p>
            <p className={styles.emptySubtext}>
              {containerLoading ? "Loading containers..." : "No containers available from your Portainer instance(s)."}
            </p>
          </div>
        </Card>
      ) : intents.length === 0 ? (
        <Card className={styles.emptyState}>
          <div className={styles.emptyContent}>
            <p>No auto-update intents created yet.</p>
            <p className={styles.emptySubtext}>
              Create an intent to automatically upgrade containers matching your criteria.
            </p>
          </div>
        </Card>
      ) : (
        <div className={styles.intentsList}>
          {intents.map((intent) => (
            <Card key={intent.id} className={styles.intentCard}>
              <div className={styles.intentContent}>
                <div className={styles.intentHeader}>
                  <button
                    className={styles.toggleButton}
                    onClick={() => handleToggleIntent(intent.id, intent.enabled)}
                    title={intent.enabled ? "Click to disable" : "Click to enable"}
                  >
                    {intent.enabled ? (
                      <CheckCircle size={20} className={styles.enabledIcon} />
                    ) : (
                      <Circle size={20} className={styles.disabledIcon} />
                    )}
                  </button>

                  <div className={styles.intentInfo}>
                    <div className={styles.intentName}>
                      {intent.description || getIntentDescription(intent)}
                    </div>
                    <div className={styles.intentMeta}>
                      <span className={styles.type}>{getIntentType(intent)}</span>
                      <span className={styles.target}>{getIntentDescription(intent)}</span>
                      <span className={`${styles.status} ${intent.enabled ? styles.enabled : styles.disabled}`}>
                        {intent.enabled ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className={styles.intentActions}>
                  <button
                    className={styles.actionButton}
                    onClick={() => handleEditIntent(intent)}
                    title="Edit intent"
                  >
                    <Edit2 size={16} />
                    Edit
                  </button>
                  <button
                    className={styles.actionButton}
                    onClick={() => handleDeleteIntent(intent.id)}
                    disabled={deleting === intent.id}
                    title="Delete intent"
                  >
                    <Trash2 size={16} />
                    {deleting === intent.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showModal && (
        <IntentModal
          intent={editingIntent}
          containers={containers}
          onClose={() => {
            setShowModal(false);
            setEditingIntent(null);
          }}
          onSuccess={handleModalSuccess}
          serverUrl={serverUrl}
        />
      )}
    </div>
  );
};

AutoUpdateIntentsTab.propTypes = {
  portainerInstances: PropTypes.array,
};

export default AutoUpdateIntentsTab;

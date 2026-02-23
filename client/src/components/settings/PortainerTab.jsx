import React, { useState, useCallback, lazy, Suspense } from "react";
import PropTypes from "prop-types";
import { Lock, Package } from "lucide-react";
import PortainerIcon from "../icons/PortainerIcon";
import Card from "../ui/Card";
import ConfirmDialog from "../ui/ConfirmDialog";
import Button from "../ui/Button";
import LoadingSpinner from "../ui/LoadingSpinner";
import InstanceDetailModal from "./InstanceDetailModal";
import styles from "./PortainerTab.module.css";

const IntentsPage = lazy(() => import("../../pages/IntentsPage"));

/**
 * PortainerTab Component
 * Manages Portainer instances
 */
const PortainerTab = React.memo(function PortainerTab({
  portainerInstances,
  onEditInstance,
  handleEditInstance,
  handleDeleteInstance,
  onClearPortainerData,
  clearingPortainerData,
  containers = [],
  portainerInstancesProp = [],
}) {
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, instanceId: null });
  const [portainerConfirm, setPortainerConfirm] = useState(false);
  const [detailInstance, setDetailInstance] = useState(null);

  const handleDeleteClick = useCallback((instanceId) => {
    setDeleteConfirm({ isOpen: true, instanceId });
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteConfirm.instanceId) {
      handleDeleteInstance(deleteConfirm.instanceId);
    }
    setDeleteConfirm({ isOpen: false, instanceId: null });
  }, [deleteConfirm.instanceId, handleDeleteInstance]);

  const handleClearPortainerData = useCallback(async () => {
    if (!onClearPortainerData) {
      alert("Error: Clear Portainer Data handler is not available. Please refresh the page.");
      return;
    }
    try {
      // Skip confirmation since ConfirmDialog already handled it
      await onClearPortainerData(true);
      setPortainerConfirm(false);
    } catch (error) {
      console.error("Error clearing Portainer data:", error);
      alert("Error clearing Portainer data: " + (error.message || "Unknown error"));
    }
  }, [onClearPortainerData]);

  const handleDeleteClose = useCallback(() => {
    setDeleteConfirm({ isOpen: false, instanceId: null });
  }, []);

  const handlePortainerConfirmClose = useCallback(() => {
    setPortainerConfirm(false);
  }, []);

  const handleEditInstanceClick = useCallback(
    (instance) => {
      if (onEditInstance) {
        onEditInstance(instance);
      } else {
        handleEditInstance(instance);
      }
    },
    [onEditInstance, handleEditInstance]
  );

  const handleAddInstanceClick = useCallback(() => {
    if (onEditInstance) {
      onEditInstance(null);
    }
  }, [onEditInstance]);

  return (
    <div className={styles.updateSection}>
      <h3 className={styles.title}>Manage Portainer Instances</h3>
      <p className={styles.description}>
        Manage your Portainer instances. Add, edit, or remove instances below.
      </p>

      <div className={styles.instancesSection}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>Existing Instances</h4>
        </div>
        <div className={styles.instancesList}>
          {portainerInstances.map((instance) => (
            <Card
              key={instance.id}
              variant="default"
              padding="sm"
              className={styles.instanceCard}
              onClick={() => setDetailInstance(instance)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setDetailInstance(instance)}
            >
              <div className={styles.instanceContent}>
                <div className={styles.instanceInfo}>
                  <div className={styles.instanceHeader}>
                    <strong className={styles.instanceName}>{instance.name}</strong>
                  </div>
                  <div className={styles.instanceBadges}>
                    {instance.auth_type === "apikey" ? (
                      <span className={styles.authBadge}>
                        <Package size={11} className={styles.badgeIcon} />
                        API Key
                      </span>
                    ) : (
                      <span className={styles.authBadge}>
                        <Lock size={11} className={styles.badgeIcon} />
                        Password
                      </span>
                    )}
                  </div>
                  <div className={styles.instanceUrl}>{instance.url}</div>
                  {instance.auth_type === "password" && instance.username && (
                    <div className={styles.instanceUsername}>{instance.username}</div>
                  )}
                </div>
              </div>
            </Card>
          ))}
          <div
            className={styles.addInstanceCard}
            onClick={handleAddInstanceClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && handleAddInstanceClick()}
          >
            <PortainerIcon size={24} className={styles.addInstanceIcon} />
            <span className={styles.addInstanceText}>Add Instance</span>
          </div>
        </div>
      </div>

      {/* Intents Section */}
      <div className={styles.intentsSection}>
        <Suspense fallback={<LoadingSpinner size="sm" message="Loading intents..." />}>
          <IntentsPage containers={containers} portainerInstances={portainerInstancesProp} />
        </Suspense>
      </div>

      <InstanceDetailModal
        instance={detailInstance}
        isOpen={!!detailInstance}
        onClose={() => setDetailInstance(null)}
        onEdit={(inst) => {
          setDetailInstance(null);
          handleEditInstanceClick(inst);
        }}
        onDelete={(instanceId) => {
          handleDeleteClick(instanceId);
        }}
      />

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={handleDeleteClose}
        onConfirm={handleDeleteConfirm}
        title="Delete Portainer Instance?"
        message="Are you sure you want to delete this Portainer instance? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />

      <div className={styles.dataManagement}>
        <h4 className={styles.sectionTitle}>Data Management</h4>
        <div className={styles.dataActions}>
          <div className={styles.dataActionItem}>
            <Button
              type="button"
              variant="danger"
              onClick={() => setPortainerConfirm(true)}
              disabled={clearingPortainerData}
              className={styles.dangerButton}
            >
              {clearingPortainerData ? "Clearing..." : "Clear Portainer Data"}
            </Button>
            <small className={styles.dataActionHelper}>
              Removes all cached container information from Portainer instances. This will clear
              container data, stacks, and unused images. Portainer instance configurations will be
              preserved.
            </small>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={portainerConfirm}
        onClose={handlePortainerConfirmClose}
        onConfirm={handleClearPortainerData}
        title="Clear Portainer Data?"
        message="This will remove all cached container information from Portainer instances. This action cannot be undone."
        confirmText="Clear Data"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
});

PortainerTab.propTypes = {
  portainerInstances: PropTypes.arrayOf(PropTypes.object).isRequired,
  onEditInstance: PropTypes.func,
  handleEditInstance: PropTypes.func.isRequired,
  handleDeleteInstance: PropTypes.func.isRequired,
  onClearPortainerData: PropTypes.func,
  clearingPortainerData: PropTypes.bool,
  containers: PropTypes.array,
  portainerInstancesProp: PropTypes.array,
};

export default PortainerTab;

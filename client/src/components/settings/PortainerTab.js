import React from "react";
import PropTypes from "prop-types";
import { Lock, Package, Plus } from "lucide-react";
import Card from "../ui/Card";
import ActionButtons from "../ui/ActionButtons";
import ConfirmDialog from "../ui/ConfirmDialog";
import styles from "./PortainerTab.module.css";

/**
 * PortainerTab Component
 * Manages Portainer instances
 */
const PortainerTab = React.memo(function PortainerTab({
  portainerInstances,
  onEditInstance,
  handleEditInstance,
  handleDeleteInstance,
}) {
  const [deleteConfirm, setDeleteConfirm] = React.useState({ isOpen: false, instanceId: null });

  const handleDeleteClick = (instanceId) => {
    setDeleteConfirm({ isOpen: true, instanceId });
  };

  const handleDeleteConfirm = () => {
    if (deleteConfirm.instanceId) {
      handleDeleteInstance(deleteConfirm.instanceId);
    }
    setDeleteConfirm({ isOpen: false, instanceId: null });
  };

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
            <Card key={instance.id} variant="default" padding="md" className={styles.instanceCard}>
              <div className={styles.instanceContent}>
                <div className={styles.instanceInfo}>
                  <div className={styles.instanceHeader}>
                    <strong className={styles.instanceName}>{instance.name}</strong>
                    {instance.auth_type === "apikey" ? (
                      <span className={styles.authBadge}>
                        <Package size={14} className={styles.badgeIcon} />
                        API Key
                      </span>
                    ) : (
                      <span className={styles.authBadge}>
                        <Lock size={14} className={styles.badgeIcon} />
                        Username / Password
                      </span>
                    )}
                  </div>
                  <div className={styles.instanceUrl}>{instance.url}</div>
                  {instance.auth_type === "password" && instance.username && (
                    <div className={styles.instanceUsername}>Username: {instance.username}</div>
                  )}
                </div>
                <ActionButtons
                  onEdit={() => {
                    if (onEditInstance) {
                      onEditInstance(instance);
                    } else {
                      handleEditInstance(instance);
                    }
                  }}
                  onDelete={() => handleDeleteClick(instance.id)}
                />
              </div>
            </Card>
          ))}
          <Card
            variant="default"
            padding="md"
            className={styles.addInstanceCard}
            onClick={() => {
              if (onEditInstance) {
                onEditInstance(null);
              }
            }}
          >
            <div className={styles.addInstanceContent}>
              <div className={styles.addInstanceText}>
                <Plus size={20} className={styles.addInstanceIcon} />
                <span>Add Instance</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, instanceId: null })}
        onConfirm={handleDeleteConfirm}
        title="Delete Portainer Instance?"
        message="Are you sure you want to delete this Portainer instance? This action cannot be undone."
        confirmText="Delete"
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
};

export default PortainerTab;

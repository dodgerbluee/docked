import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Lock, Package, Plus } from "lucide-react";
import Card from "../ui/Card";
import ActionButtons from "../ui/ActionButtons";
import ConfirmDialog from "../ui/ConfirmDialog";
import Button from "../ui/Button";
import { useRepositoryAccessTokens } from "../../hooks/useRepositoryAccessTokens";
import { usePageVisibilitySettings } from "../../hooks/usePageVisibilitySettings";
import GitHubIcon from "../icons/GitHubIcon";
import GitLabIcon from "../icons/GitLabIcon";
import { SETTINGS_TABS } from "../../constants/settings";
import AssociateImagesModal from "./AssociateImagesModal";
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
  onClearPortainerData,
  clearingPortainerData,
}) {
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, instanceId: null });
  const [portainerConfirm, setPortainerConfirm] = useState(false);
  const [associateImagesModalOpen, setAssociateImagesModalOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState(null);

  const { tokens, loading: tokensLoading } = useRepositoryAccessTokens({
    activeSection: SETTINGS_TABS.PORTAINER,
  });

  const {
    disablePortainerPage: initialDisablePortainerPage,
    updateDisablePortainerPage,
    refreshSettings,
  } = usePageVisibilitySettings();

  const [localDisablePortainerPage, setLocalDisablePortainerPage] = useState(
    initialDisablePortainerPage
  );
  const [saving, setSaving] = useState(false);

  // Update local state when initial value changes
  useEffect(() => {
    setLocalDisablePortainerPage(initialDisablePortainerPage);
  }, [initialDisablePortainerPage]);

  const handleDisablePortainerPageChange = (e) => {
    setLocalDisablePortainerPage(e.target.checked);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const success = await updateDisablePortainerPage(localDisablePortainerPage);
      if (success) {
        // Refresh settings to ensure sync
        await refreshSettings();
        // Dispatch custom event to notify HomePage to refresh
        window.dispatchEvent(new CustomEvent("pageVisibilitySettingsUpdated"));
      }
    } catch (error) {
      console.error("Error saving page visibility settings:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = (instanceId) => {
    setDeleteConfirm({ isOpen: true, instanceId });
  };

  const handleDeleteConfirm = () => {
    if (deleteConfirm.instanceId) {
      handleDeleteInstance(deleteConfirm.instanceId);
    }
    setDeleteConfirm({ isOpen: false, instanceId: null });
  };

  const handleClearPortainerData = async () => {
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
  };

  const handleAssociateImages = (token) => {
    setSelectedToken(token);
    setAssociateImagesModalOpen(true);
  };

  const getProviderIcon = (provider) => {
    return provider === "github" ? GitHubIcon : GitLabIcon;
  };

  const getProviderLabel = (provider) => {
    return provider === "github" ? "GitHub" : "GitLab";
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

      <div className={styles.repositoryTokensSection}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>Repositories</h4>
        </div>
        {tokensLoading ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyText}>Loading repositories...</p>
          </div>
        ) : tokens.length === 0 ? (
          <Card variant="default" padding="md" className={styles.emptyTokenCard}>
            <p className={styles.emptyText}>
              No repository access tokens configured. Add tokens on the{" "}
              <strong>Repositories</strong> tab to associate them with your container images.
            </p>
          </Card>
        ) : (
          <div className={styles.tokensGrid}>
            {tokens.map((token) => {
              const IconComponent = getProviderIcon(token.provider);
              return (
                <Card key={token.id} variant="default" padding="md" className={styles.tokenCard}>
                  <div className={styles.tokenContent}>
                    <div className={styles.tokenInfo}>
                      <div className={styles.tokenHeader}>
                        <span className={styles.tokenIcon}>
                          <IconComponent size={18} />
                        </span>
                        <strong className={styles.tokenProvider}>
                          {token.name || getProviderLabel(token.provider)}
                        </strong>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleAssociateImages(token)}
                      disabled={tokensLoading}
                    >
                      Associate Images
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className={styles.pageVisibilitySection}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>Page Visibility</h4>
        </div>
        <Card variant="default" padding="md" className={styles.visibilityCard}>
          <div className={styles.checkboxContainer}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={localDisablePortainerPage}
                onChange={handleDisablePortainerPageChange}
                className={styles.checkbox}
              />
              <span className={styles.checkboxText}>Disable Portainer Page</span>
            </label>
            <p className={styles.checkboxNote}>
              This will disable the functionality of the Portainer page. The Portainer tab will be
              hidden from the home page navigation.
            </p>
          </div>
          <div className={styles.formActions}>
            <Button
              type="button"
              variant="primary"
              onClick={handleSave}
              disabled={saving || localDisablePortainerPage === initialDisablePortainerPage}
              className={styles.saveButton}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </Card>
      </div>

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
        onClose={() => setPortainerConfirm(false)}
        onConfirm={handleClearPortainerData}
        title="Clear Portainer Data?"
        message="This will remove all cached container information from Portainer instances. This action cannot be undone."
        confirmText="Clear Data"
        cancelText="Cancel"
        variant="danger"
      />

      <AssociateImagesModal
        isOpen={associateImagesModalOpen}
        onClose={() => {
          setAssociateImagesModalOpen(false);
          setSelectedToken(null);
        }}
        token={selectedToken}
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
};

export default PortainerTab;

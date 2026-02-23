import React, { useState } from "react";
import { useSSOProviders } from "../../hooks/useSSOProviders";
import SSOProviderCard from "./SSOProviderCard";
import SSOProviderModal from "./SSOProviderModal";
import ToggleButton from "../ui/ToggleButton";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import ConfirmDialog from "../ui/ConfirmDialog";
import LoadingSpinner from "../ui/LoadingSpinner";
import styles from "./SSOTab.module.css";

const TOGGLE_OPTIONS = [
  { value: "true", label: "Enabled" },
  { value: "false", label: "Disabled" },
];

/**
 * SSOTab Component
 * Admin tab for managing OAuth/SSO providers and global SSO settings.
 */
function SSOTab() {
  const {
    providers,
    settings,
    loading,
    error,
    createProvider,
    updateProvider,
    deleteProvider,
    testConnection,
    updateSettings,
  } = useSSOProviders();

  const [showModal, setShowModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, providerId: null });
  const [successMessage, setSuccessMessage] = useState("");

  const showSuccess = (msg) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(""), 3000);
  };

  const handleAdd = () => {
    setEditingProvider(null);
    setShowModal(true);
  };

  const handleEdit = (provider) => {
    setEditingProvider(provider);
    setShowModal(true);
  };

  const handleDeleteClick = (providerId) => {
    setDeleteConfirm({ isOpen: true, providerId });
  };

  const handleDeleteConfirm = async () => {
    if (deleteConfirm.providerId) {
      try {
        await deleteProvider(deleteConfirm.providerId);
        showSuccess("SSO provider removed successfully!");
      } catch (err) {
        console.error("Failed to delete provider:", err);
      }
    }
    setDeleteConfirm({ isOpen: false, providerId: null });
  };

  const handleModalSuccess = () => {
    showSuccess(editingProvider ? "SSO provider updated!" : "SSO provider created!");
    setShowModal(false);
    setEditingProvider(null);
  };

  const handleAllowLocalLoginToggle = async (value) => {
    try {
      await updateSettings({ allowLocalLogin: value === "true" });
    } catch (err) {
      console.error("Failed to update SSO settings:", err);
    }
  };

  if (loading) {
    return <LoadingSpinner size="md" message="Loading SSO configuration..." />;
  }

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Single Sign-On (SSO)</h3>
      <p className={styles.description}>
        Configure OAuth/OpenID Connect providers to enable SSO login. Users can sign in using any
        enabled provider. Environment variable configuration is used as a fallback when no
        database-configured providers exist.
      </p>

      {error && <Alert variant="error">{error}</Alert>}
      {successMessage && <Alert variant="info">{successMessage}</Alert>}

      {/* Global Settings */}
      <div className={styles.settingsSection}>
        <h4 className={styles.settingsTitle}>Global Settings</h4>
        <div className={styles.settingRow}>
          <span className={styles.settingLabel}>
            Allow local (password) login when SSO is configured
          </span>
          <ToggleButton
            options={TOGGLE_OPTIONS}
            value={String(settings.allowLocalLogin)}
            onChange={handleAllowLocalLoginToggle}
          />
        </div>
      </div>

      {/* Provider List */}
      {providers.length > 0 ? (
        <div className={styles.providersList}>
          {providers.map((provider) => (
            <SSOProviderCard
              key={provider.id}
              provider={provider}
              onEdit={() => handleEdit(provider)}
              onDelete={() => handleDeleteClick(provider.id)}
            />
          ))}
        </div>
      ) : (
        <p className={styles.emptyState}>
          No SSO providers configured in the database. Add one below, or configure via environment
          variables.
        </p>
      )}

      <Button type="button" variant="primary" onClick={handleAdd} className={styles.addButton}>
        Add Provider
      </Button>

      <SSOProviderModal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setEditingProvider(null);
        }}
        onSuccess={handleModalSuccess}
        existingProvider={editingProvider}
        createProvider={createProvider}
        updateProvider={updateProvider}
        testConnection={testConnection}
      />

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, providerId: null })}
        onConfirm={handleDeleteConfirm}
        title="Remove SSO Provider?"
        message="Are you sure you want to remove this SSO provider? Users who sign in via this provider will no longer be able to authenticate."
        confirmText="Remove"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
}

export default SSOTab;

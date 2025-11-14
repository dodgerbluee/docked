/**
 * TrackedAppsPage Component
 * Main page component for the Tracked Apps view
 */

import React, { useMemo, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { RefreshCw, Check } from 'lucide-react';
import { useTrackedApps } from '../hooks/useTrackedApps';
import TrackedAppCard from '../components/TrackedAppCard';
import AddTrackedImageModal from '../components/AddTrackedImageModal';
import ConfirmDialog from '../components/ConfirmDialog';
import Button from '../components/ui/Button';
import styles from './TrackedAppsPage.module.css';

/**
 * TrackedAppsPage component
 * @param {Object} props - Component props
 * @param {Function} props.onDeleteTrackedImage - Handler for deleting tracked images
 * @param {Function} props.onUpgradeTrackedImage - Handler for upgrading tracked images (to refresh App.js state)
 * @param {Function} props.onEditTrackedImage - Handler for editing tracked images (to refresh App.js state)
 */
function TrackedAppsPage({ onDeleteTrackedImage, onUpgradeTrackedImage, onEditTrackedImage }) {
  const {
    trackedImages,
    trackedImageError,
    trackedImageSuccess,
    checkingUpdates,
    lastScanTime,
    editingTrackedImageData,
    showAddTrackedImageModal,
    handleTrackedImageModalSuccess,
    handleDeleteTrackedImage,
    handleUpgradeTrackedImage,
    handleEditTrackedImage,
    handleCheckTrackedImagesUpdates,
    setShowAddTrackedImageModal,
    setEditingTrackedImageData,
    confirmDialog,
    setConfirmDialog,
  } = useTrackedApps();

  const [showCheckmark, setShowCheckmark] = useState(false);
  const [selectedApps, setSelectedApps] = useState(new Set());

  const handleToggleSelect = (appId) => {
    setSelectedApps((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(appId)) {
        newSet.delete(appId);
      } else {
        newSet.add(appId);
      }
      return newSet;
    });
  };

  // Show checkmark when check completes successfully
  useEffect(() => {
    if (trackedImageSuccess && !checkingUpdates) {
      setShowCheckmark(true);
      // Hide checkmark after 3 seconds
      const timer = setTimeout(() => setShowCheckmark(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [trackedImageSuccess, checkingUpdates]);

  // Hide checkmark when checking starts
  useEffect(() => {
    if (checkingUpdates) {
      setShowCheckmark(false);
    }
  }, [checkingUpdates]);

  // Memoize filtered arrays to prevent unnecessary recalculations
  const appsWithUpdates = useMemo(
    () => trackedImages.filter((img) => img.has_update),
    [trackedImages]
  );
  const appsWithoutUpdates = useMemo(
    () => trackedImages.filter((img) => !img.has_update),
    [trackedImages]
  );

  // Handle delete with callback
  const handleDelete = async (id) => {
    await handleDeleteTrackedImage(id);
    if (onDeleteTrackedImage) {
      onDeleteTrackedImage(id);
    }
  };

  // Handle upgrade with callback to refresh App.js state
  const handleUpgrade = async (id, latestVersion) => {
    await handleUpgradeTrackedImage(id, latestVersion);
    if (onUpgradeTrackedImage) {
      await onUpgradeTrackedImage();
    }
  };

  // Handle modal success with callback to refresh App.js state
  const handleModalSuccess = async (imageId) => {
    await handleTrackedImageModalSuccess(imageId);
    // Refresh App.js state after editing/adding to update notification count
    if (onEditTrackedImage) {
      await onEditTrackedImage();
    }
  };

  // Render add new app card
  const renderAddNewCard = () => (
    <div
      className={styles.addCard}
      onClick={() => {
        setEditingTrackedImageData(null); // Clear any editing state
        setShowAddTrackedImageModal(true);
      }}
      title="Track updates for Docker images or GitHub repositories. Docker examples: homeassistant/home-assistant, authentik/authentik, jellyfin/jellyfin, plexinc/pms-docker. GitHub examples: home-assistant/core, goauthentik/authentik, jellyfin/jellyfin"
    >
      <div className={styles.addCardIcon}>+</div>
    </div>
  );

  return (
    <div className={styles.trackedAppsPage}>
      <div className={styles.summaryHeader}>
        <div className={styles.headerContent}>
          <h2 className={styles.summaryHeaderTitle}>Tracked Apps</h2>
          <div className={styles.buttonContainer}>
            <Button
              onClick={handleCheckTrackedImagesUpdates}
              disabled={checkingUpdates || trackedImages.length === 0}
              title={checkingUpdates ? 'Checking for updates...' : 'Check for updates'}
              variant="outline"
              icon={RefreshCw}
              size="sm"
            >
              {checkingUpdates ? 'Checking for Updates...' : 'Check for Updates'}
            </Button>
            {showCheckmark && (
              <Check className={styles.checkmark} size={20} />
            )}
          </div>
        </div>
      </div>

      <div className={styles.contentTabPanel}>
        {trackedImageError && (
          <div className={styles.errorMessage}>{trackedImageError}</div>
        )}

        {trackedImages.length > 0 ? (
          <div className={styles.appsContainer}>
            {/* Apps with updates - shown at the top */}
            {appsWithUpdates.length > 0 && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Apps with Updates</h3>
                <div className={styles.gridWithUpdates}>
                  {appsWithUpdates.map((image) => (
                    <TrackedAppCard
                      key={image.id}
                      image={image}
                      onEdit={handleEditTrackedImage}
                      onUpgrade={handleUpgrade}
                      selected={selectedApps.has(image.id)}
                      onToggleSelect={handleToggleSelect}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Apps without updates - shown below */}
            {(appsWithoutUpdates.length > 0 || appsWithUpdates.length === 0) && (
              <div className={styles.section}>
                {appsWithUpdates.length > 0 && appsWithoutUpdates.length > 0 && (
                  <h3 className={styles.sectionTitle}>All Other Apps</h3>
                )}
                <div className={styles.gridWithoutUpdates}>
                  {appsWithoutUpdates.map((image) => (
                    <TrackedAppCard
                      key={image.id}
                      image={image}
                      onEdit={handleEditTrackedImage}
                      onUpgrade={handleUpgrade}
                    />
                  ))}
                  {/* Add new app button - always at the end */}
                  {renderAddNewCard()}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.grid}>
              {renderAddNewCard()}
            </div>
          </div>
        )}

        {lastScanTime && (
          <div className={styles.lastScanTime}>
            Last scanned:{' '}
            {lastScanTime.toLocaleString(undefined, {
              year: 'numeric',
              month: 'numeric',
              day: 'numeric',
              hour: 'numeric',
              minute: 'numeric',
              hour12: true,
            })}
          </div>
        )}
      </div>

      <AddTrackedImageModal
        isOpen={showAddTrackedImageModal}
        onClose={() => {
          setEditingTrackedImageData(null); // Clear editing state when modal closes
          setShowAddTrackedImageModal(false);
        }}
        onSuccess={handleModalSuccess}
        trackedImages={trackedImages}
        initialData={editingTrackedImageData}
          onDelete={handleDelete}
      />

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={() => {
          if (confirmDialog.onConfirm) {
            confirmDialog.onConfirm();
          }
        }}
        onCancel={() =>
          setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: null })
        }
      />
    </div>
  );
}

TrackedAppsPage.propTypes = {
  onDeleteTrackedImage: PropTypes.func,
};

export default TrackedAppsPage;


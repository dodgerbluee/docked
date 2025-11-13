/**
 * TrackedAppsPage Component
 * Main page component for the Tracked Apps view
 */

import React from 'react';
import PropTypes from 'prop-types';
import { RefreshCw } from 'lucide-react';
import { useTrackedApps } from '../hooks/useTrackedApps';
import TrackedAppCard from '../components/TrackedAppCard';
import AddTrackedImageModal from '../components/AddTrackedImageModal';
import styles from './TrackedAppsPage.module.css';

/**
 * TrackedAppsPage component
 * @param {Object} props - Component props
 * @param {Function} props.onDeleteTrackedImage - Handler for deleting tracked images
 */
function TrackedAppsPage({ onDeleteTrackedImage }) {
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
  } = useTrackedApps();

  // Separate apps with updates from those without
  const appsWithUpdates = trackedImages.filter((img) => img.has_update);
  const appsWithoutUpdates = trackedImages.filter((img) => !img.has_update);

  // Handle delete with callback
  const handleDelete = async (id) => {
    await handleDeleteTrackedImage(id);
    if (onDeleteTrackedImage) {
      onDeleteTrackedImage(id);
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
    <div className={styles.page}>
      <div className={styles.header}>
        <h2>Tracked Apps</h2>
        <button
          onClick={handleCheckTrackedImagesUpdates}
          disabled={checkingUpdates || trackedImages.length === 0}
          title={checkingUpdates ? 'Checking for updates...' : 'Check for updates'}
          className={styles.refreshButton}
        >
          <RefreshCw
            size={18}
            style={{
              animation: checkingUpdates ? 'spin 1s linear infinite' : 'none',
            }}
          />
        </button>
      </div>

      <div className={styles.content}>
        {trackedImageError && (
          <div className={styles.errorMessage}>{trackedImageError}</div>
        )}
        {trackedImageSuccess && (
          <div className={styles.successMessage}>{trackedImageSuccess}</div>
        )}

        {trackedImages.length > 0 ? (
          <div className={styles.appsContainer}>
            {/* Apps with updates - shown at the top */}
            {appsWithUpdates.length > 0 && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Apps with Updates</h3>
                <div className={styles.grid}>
                  {appsWithUpdates.map((image) => (
                    <TrackedAppCard
                      key={image.id}
                      image={image}
                      onEdit={handleEditTrackedImage}
                      onUpgrade={handleUpgradeTrackedImage}
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
                <div className={styles.grid}>
                  {appsWithoutUpdates.map((image) => (
                    <TrackedAppCard
                      key={image.id}
                      image={image}
                      onEdit={handleEditTrackedImage}
                      onUpgrade={handleUpgradeTrackedImage}
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
      </div>

      {lastScanTime && (
        <div className={styles.lastScanTime}>
          Last scanned:{' '}
          {lastScanTime.toLocaleString('en-US', {
            timeZone: 'America/Chicago',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            hour12: true,
          })}
        </div>
      )}

      <AddTrackedImageModal
        isOpen={showAddTrackedImageModal}
        onClose={() => {
          setEditingTrackedImageData(null); // Clear editing state when modal closes
          setShowAddTrackedImageModal(false);
        }}
        onSuccess={handleTrackedImageModalSuccess}
        trackedImages={trackedImages}
        initialData={editingTrackedImageData}
        onDelete={handleDelete}
      />
    </div>
  );
}

TrackedAppsPage.propTypes = {
  onDeleteTrackedImage: PropTypes.func,
};

export default TrackedAppsPage;


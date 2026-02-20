/**
 * TrackedAppsPage Component
 * Main page component for the Tracked Apps view
 */

import React, { useState, useCallback, useEffect } from "react";
import PropTypes from "prop-types";
import { useTrackedApps } from "../hooks/useTrackedApps";
import AddTrackedAppModal from "../components/AddTrackedAppModal";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import ErrorBoundary from "../components/ErrorBoundary";
import MobileDrawer from "../components/ui/MobileDrawer";
import TrackedAppsSidebar from "../components/trackedApps/TrackedAppsSidebar";
import { TRACKED_APPS_CONTENT_TABS } from "../constants/trackedAppsPage";
import styles from "./TrackedAppsPage.module.css";
import TrackedAppsHeader from "./TrackedAppsPage/components/TrackedAppsHeader";
import TrackedAppsContentArea from "./TrackedAppsPage/components/TrackedAppsContentArea";
import { useTrackedAppsFiltering } from "./TrackedAppsPage/hooks/useTrackedAppsFiltering";
import { useIsMobile } from "../hooks/useIsMobile";

/**
 * TrackedAppsPage component
 * @param {Object} props - Component props
 * @param {Function} props.onDeleteTrackedApp - Handler for deleting tracked apps
 * @param {Function} props.onUpgradeTrackedApp - Handler for upgrading tracked apps (to refresh App.js state)
 * @param {Function} props.onEditTrackedApp - Handler for editing tracked apps (to refresh App.js state)
 * @param {Function} props.onNavigateToSettings - Handler for navigating to Settings page
 */
function TrackedAppsPage({
  onDeleteTrackedApp,
  onUpgradeTrackedApp,
  onEditTrackedApp,
  onNavigateToSettings,
}) {
  const {
    trackedApps,
    isLoading,
    hasLoadedOnce,
    trackedAppError,
    checkingUpdates,
    lastScanTime,
    editingTrackedAppData,
    showAddTrackedAppModal,
    handleTrackedAppModalSuccess,
    handleDeleteTrackedApp,
    handleUpgradeTrackedApp,
    handleEditTrackedApp,
    handleCheckTrackedAppsUpdates,
    setShowAddTrackedAppModal,
    setEditingTrackedAppData,
    confirmDialog,
    setConfirmDialog,
  } = useTrackedApps();

  const [contentTab, setContentTab] = useState(TRACKED_APPS_CONTENT_TABS.ALL);
  const [selectedSourceFilters, setSelectedSourceFilters] = useState(new Set());
  const [collapsedSections, setCollapsedSections] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  // Mobile-only sidebar drawer state (MobileDrawer handles escape, scroll lock, focus trap)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  const openMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(true);
  }, []);

  // Check if modal should open after navigation from welcome page
  useEffect(() => {
    const shouldOpenModal = sessionStorage.getItem("openTrackedAppModal") === "true";
    if (shouldOpenModal) {
      sessionStorage.removeItem("openTrackedAppModal");
      setEditingTrackedAppData(null);
      // Small delay to ensure page is fully rendered
      setTimeout(() => {
        setShowAddTrackedAppModal(true);
      }, 100);
    }
  }, [setEditingTrackedAppData, setShowAddTrackedAppModal]);

  // Use extracted hooks
  const { appsWithUpdates, appsWithoutUpdates, displayedApps } = useTrackedAppsFiltering(
    trackedApps,
    selectedSourceFilters,
    searchQuery,
    contentTab
  );

  // Handle delete with callback
  const handleDelete = async (id) => {
    await handleDeleteTrackedApp(id);
    if (onDeleteTrackedApp) {
      onDeleteTrackedApp(id);
    }
  };

  // Handle upgrade with callback to refresh App.js state
  const handleUpgrade = useCallback(
    async (id, latestVersion) => {
      await handleUpgradeTrackedApp(id, latestVersion);
      if (onUpgradeTrackedApp) {
        await onUpgradeTrackedApp();
      }
    },
    [handleUpgradeTrackedApp, onUpgradeTrackedApp]
  );

  // Handle modal success with callback to refresh App.js state
  const handleModalSuccess = async (appId) => {
    await handleTrackedAppModalSuccess(appId);
    // Refresh App.js state after editing/adding to update notification count
    if (onEditTrackedApp) {
      await onEditTrackedApp();
    }
  };

  const handleToggleSection = useCallback((sectionKey) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }
      return next;
    });
  }, []);

  const handleAddNew = useCallback(() => {
    setEditingTrackedAppData(null); // Clear any editing state
    setShowAddTrackedAppModal(true);
  }, [setEditingTrackedAppData, setShowAddTrackedAppModal]);

  return (
    <div className={styles.trackedAppsPage}>
      <TrackedAppsHeader
        searchQuery={searchQuery}
        onSearchChange={(e) => setSearchQuery(e.target.value)}
        onCheckUpdates={handleCheckTrackedAppsUpdates}
        checkingUpdates={checkingUpdates}
        trackedAppsCount={trackedApps.length}
        mobileSidebarOpen={mobileSidebarOpen}
        onMobileSidebarOpen={openMobileSidebar}
      />

      <div className={styles.trackedAppsSidebarLayout}>
        {/* Desktop: render sidebar inline */}
        {!isMobile && (
          <ErrorBoundary>
            <div
              className={styles.trackedAppsSidebar}
              role="complementary"
              aria-label="Tracked apps filters"
            >
              <TrackedAppsSidebar
                contentTab={contentTab}
                onContentTabChange={(tab) => {
                  setContentTab(tab);
                }}
                selectedSourceFilters={selectedSourceFilters}
                onSelectedSourceFiltersChange={(next) => {
                  setSelectedSourceFilters(next);
                }}
              />
            </div>
          </ErrorBoundary>
        )}

        {/* Mobile: render sidebar in shared MobileDrawer */}
        <ErrorBoundary>
          <MobileDrawer
            isOpen={mobileSidebarOpen}
            onClose={closeMobileSidebar}
            title="Filters"
            ariaLabel="Tracked apps filters"
          >
            <TrackedAppsSidebar
              contentTab={contentTab}
              onContentTabChange={(tab) => {
                setContentTab(tab);
                closeMobileSidebar();
              }}
              selectedSourceFilters={selectedSourceFilters}
              onSelectedSourceFiltersChange={(next) => {
                setSelectedSourceFilters(next);
              }}
            />
          </MobileDrawer>
        </ErrorBoundary>

        <div className={styles.trackedAppsContentArea}>
          {trackedAppError && <div className={styles.errorMessage}>{trackedAppError}</div>}

          <TrackedAppsContentArea
            contentTab={contentTab}
            appsWithUpdates={appsWithUpdates}
            appsWithoutUpdates={appsWithoutUpdates}
            displayedApps={displayedApps}
            collapsedSections={collapsedSections}
            onToggleSection={handleToggleSection}
            onEdit={handleEditTrackedApp}
            onUpgrade={handleUpgrade}
            onAddNew={handleAddNew}
            trackedAppsCount={trackedApps.length}
            isLoading={isLoading}
            hasLoadedOnce={hasLoadedOnce}
            onNavigateToSettings={onNavigateToSettings}
          />

          {lastScanTime && (
            <div className={styles.lastScanTime}>
              Last scanned:{" "}
              {lastScanTime.toLocaleString(undefined, {
                year: "numeric",
                month: "numeric",
                day: "numeric",
                hour: "numeric",
                minute: "numeric",
                hour12: true,
              })}
            </div>
          )}
        </div>
      </div>

      <AddTrackedAppModal
        isOpen={showAddTrackedAppModal}
        onClose={() => {
          setEditingTrackedAppData(null); // Clear editing state when modal closes
          setShowAddTrackedAppModal(false);
        }}
        onSuccess={handleModalSuccess}
        trackedApps={trackedApps}
        initialData={editingTrackedAppData}
        onDelete={handleDelete}
      />

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant || "danger"}
        onConfirm={() => {
          if (confirmDialog.onConfirm) {
            confirmDialog.onConfirm();
          }
        }}
        onClose={() => {
          if (confirmDialog.onClose) {
            confirmDialog.onClose();
          } else {
            setConfirmDialog({
              isOpen: false,
              title: "",
              message: "",
              onConfirm: null,
              onClose: null,
              variant: "danger",
            });
          }
        }}
      />
    </div>
  );
}

TrackedAppsPage.propTypes = {
  onDeleteTrackedApp: PropTypes.func,
  onUpgradeTrackedApp: PropTypes.func,
  onEditTrackedApp: PropTypes.func,
  onNavigateToSettings: PropTypes.func,
};

export default TrackedAppsPage;

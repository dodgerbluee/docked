import React, { useCallback, useMemo, useState, useEffect } from "react";
import PropTypes from "prop-types";
import { RefreshCw, Check, RotateCw } from "lucide-react";
import axios from "axios";
import ErrorModal from "../components/ErrorModal";
import ErrorBoundary from "../components/ErrorBoundary";
import Button from "../components/ui/Button";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import EmptyState from "../components/ui/EmptyState";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Alert from "../components/ui/Alert";
import UpgradeProgressModal from "../components/ui/UpgradeProgressModal";
import BatchUpgradeProgressModal from "../components/ui/BatchUpgradeProgressModal";
import PortainerSidebar from "../components/portainer/PortainerSidebar";
import ContainersTab from "../components/portainer/ContainersTab";
import UnusedTab from "../components/portainer/UnusedTab";
import SearchInput from "../components/ui/SearchInput";
import { usePortainerPage } from "../hooks/usePortainerPage";
import { useDebounce } from "../hooks/useDebounce";
import { PORTAINER_CONTENT_TABS } from "../constants/portainerPage";
import { SETTINGS_TABS } from "../constants/settings";
import { API_BASE_URL } from "../utils/api";
import { TIMING } from "../constants/timing";
import styles from "./PortainerPage.module.css";

/**
 * PortainerPage Component
 * Main page component for the Portainer Instances section with tab navigation
 */
function PortainerPage({
  portainerInstances = [],
  containers = [],
  unusedImages = [],
  unusedImagesCount = 0,
  containersByPortainer = {},
  loadingInstances = new Set(),
  dockerHubDataPulled = false,
  lastPullTime = null,
  successfullyUpdatedContainersRef,
  onContainersUpdate,
  onUnusedImagesUpdate,
  onUnusedImagesCountUpdate,
  fetchContainers,
  fetchUnusedImages,
  onAddInstance,
  onPullDockerHub,
  pullingDockerHub = false,
  pullError = null,
  pullSuccess = null,
  activeTab: controlledActiveTab,
  onTabChange: onControlledTabChange,
  selectedPortainerInstances: controlledSelectedPortainerInstances,
  onSetSelectedPortainerInstances,
  contentTab: controlledContentTab,
  onSetContentTab,
  onNavigateToSettings,
  onSetSettingsTab,
}) {
  const [localPullError, setLocalPullError] = useState("");
  const [showCheckmark, setShowCheckmark] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pullingPortainerOnly, setPullingPortainerOnly] = useState(false);
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);

  // Show checkmark when pull completes successfully
  useEffect(() => {
    // Only show checkmark when we have success and we're not currently pulling
    if (pullSuccess && !pullingDockerHub) {
      setShowCheckmark(true);
      // Hide checkmark after configured time
      const timer = setTimeout(() => {
        setShowCheckmark(false);
      }, TIMING.CHECKMARK_DISPLAY_TIME);
      return () => clearTimeout(timer);
    } else {
      // Hide checkmark when pulling starts or when there's no success
      setShowCheckmark(false);
    }
  }, [pullSuccess, pullingDockerHub]);

  useEffect(() => {
    if (pullError) {
      setLocalPullError(pullError);
      setShowCheckmark(false);
    } else {
      // Clear local error when pullError is cleared
      setLocalPullError("");
    }
  }, [pullError]);

  // Fetch developer mode state
  const fetchDeveloperMode = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/settings/refreshing-toggles-enabled`);
      if (response.data.success) {
        setDeveloperModeEnabled(response.data.enabled || false);
      }
    } catch (err) {
      // If endpoint doesn't exist yet, default to false
      console.error("Error fetching developer mode:", err);
      setDeveloperModeEnabled(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchDeveloperMode();
  }, [fetchDeveloperMode]);

  // Listen for settings save events to refetch developer mode
  useEffect(() => {
    const handleSettingsSaved = () => {
      fetchDeveloperMode();
    };
    window.addEventListener("generalSettingsSaved", handleSettingsSaved);
    return () => {
      window.removeEventListener("generalSettingsSaved", handleSettingsSaved);
    };
  }, [fetchDeveloperMode]);

  // Handler for Portainer-only data update (no Docker Hub)
  const handlePullPortainerOnly = useCallback(async () => {
    try {
      setPullingPortainerOnly(true);
      setLocalPullError("");
      console.log("🔄 Pulling Portainer data only (no Docker Hub)...");

      // Use fetchContainers with portainerOnly=true to update all state properly
      await fetchContainers(false, null, true);
      console.log("✅ Portainer data updated successfully");
    } catch (err) {
      console.error("Error pulling Portainer data:", err);
      setLocalPullError(
        err.response?.data?.error || err.message || "Failed to pull Portainer data"
      );
    } finally {
      setPullingPortainerOnly(false);
    }
  }, [fetchContainers]);

  const { errorModal, closeErrorModal, ...portainerPage } = usePortainerPage({
    portainerInstances,
    containers,
    unusedImages,
    unusedImagesCount,
    containersByPortainer,
    loadingInstances,
    dockerHubDataPulled,
    lastPullTime,
    successfullyUpdatedContainersRef,
    onContainersUpdate,
    onUnusedImagesUpdate,
    onUnusedImagesCountUpdate,
    fetchContainers,
    fetchUnusedImages,
    selectedPortainerInstances: controlledSelectedPortainerInstances,
    onSetSelectedPortainerInstances,
    contentTab: controlledContentTab,
    onSetContentTab,
  });

  // Debounce search query to avoid excessive filtering
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Filter containers based on search query
  const filteredGroupedStacks = useMemo(() => {
    if (!debouncedSearchQuery.trim()) {
      return portainerPage.groupedStacks;
    }

    const query = debouncedSearchQuery.toLowerCase().trim();
    return portainerPage.groupedStacks
      .map((stack) => ({
        ...stack,
        containers: stack.containers.filter((container) => {
          const name = container.name?.toLowerCase() || "";
          const image = container.image?.toLowerCase() || "";
          const stackName = stack.stackName?.toLowerCase() || "";
          return name.includes(query) || image.includes(query) || stackName.includes(query);
        }),
      }))
      .filter((stack) => stack.containers.length > 0);
  }, [portainerPage.groupedStacks, debouncedSearchQuery]);

  const handleToggleCollapsed = useCallback(() => {
    portainerPage.setCollapsedUnusedImages(!portainerPage.collapsedUnusedImages);
  }, [portainerPage]);

  // Check if we have any data at all
  const hasData =
    portainerPage.aggregatedContainers.all.length > 0 ||
    portainerPage.portainerUnusedImages.length > 0;

  // Calculate containers with updates for toolbar buttons
  const containersWithUpdates = useMemo(() => {
    if (portainerPage.contentTab !== PORTAINER_CONTENT_TABS.UPDATES) {
      return [];
    }
    return portainerPage.groupedStacks.flatMap((stack) =>
      stack.containers.filter((c) => c.hasUpdate && !portainerPage.isPortainerContainer(c))
    );
  }, [portainerPage]);

  const selectableContainersCount = containersWithUpdates.length;
  const allSelectableSelected =
    selectableContainersCount > 0 &&
    containersWithUpdates.every((c) => portainerPage.selectedContainers.has(c.id));

  // Handle batch upgrade click - now opens modal directly
  const handleBatchUpgradeClick = useCallback(() => {
    portainerPage.handleBatchUpgrade();
  }, [portainerPage]);

  // Handle batch delete for unused images
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);

  const handleBatchDeleteClick = useCallback(() => {
    const deleteData = portainerPage.handleDeleteImages();
    if (deleteData) {
      setBatchDeleteConfirm(true);
    }
  }, [portainerPage]);

  const handleBatchDeleteConfirm = useCallback(async () => {
    const deleteData = portainerPage.handleDeleteImages();
    if (deleteData?.images) {
      await portainerPage.executeDeleteImages(deleteData.images);
      setBatchDeleteConfirm(false);
    }
  }, [portainerPage]);

  // Toolbar actions based on active tab
  const toolbarActions = useMemo(() => {
    if (
      portainerPage.contentTab === PORTAINER_CONTENT_TABS.UPDATES &&
      selectableContainersCount > 0
    ) {
      return (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const allIds = containersWithUpdates.map((c) => c.id);
              const allSelected = allIds.every((id) => portainerPage.selectedContainers.has(id));
              if (allSelected) {
                allIds.forEach((id) => portainerPage.handleToggleSelect(id));
              } else {
                allIds.forEach((id) => {
                  if (!portainerPage.selectedContainers.has(id)) {
                    portainerPage.handleToggleSelect(id);
                  }
                });
              }
            }}
            disabled={portainerPage.batchUpgrading}
          >
            {allSelectableSelected ? "Unselect All" : "Select All"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleBatchUpgradeClick}
            disabled={portainerPage.selectedContainers.size === 0 || portainerPage.batchUpgrading}
          >
            {portainerPage.batchUpgrading
              ? `Upgrading ${portainerPage.selectedContainers.size}...`
              : `Upgrade Selected (${portainerPage.selectedContainers.size})`}
          </Button>
        </>
      );
    }

    if (
      portainerPage.contentTab === PORTAINER_CONTENT_TABS.UNUSED &&
      portainerPage.portainerUnusedImages.length > 0
    ) {
      const allImagesSelected =
        portainerPage.portainerUnusedImages.length > 0 &&
        portainerPage.portainerUnusedImages.every((img) =>
          portainerPage.selectedImages.has(img.id)
        );

      return (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const allIds = portainerPage.portainerUnusedImages.map((img) => img.id);
              const allSelected = allIds.every((id) => portainerPage.selectedImages.has(id));
              if (allSelected) {
                allIds.forEach((id) => portainerPage.handleToggleImageSelect(id));
              } else {
                allIds.forEach((id) => {
                  if (!portainerPage.selectedImages.has(id)) {
                    portainerPage.handleToggleImageSelect(id);
                  }
                });
              }
            }}
            disabled={portainerPage.deletingImages}
          >
            {allImagesSelected ? "Unselect All" : "Select All"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleBatchDeleteClick}
            disabled={portainerPage.selectedImages.size === 0 || portainerPage.deletingImages}
            className={portainerPage.selectedImages.size > 0 ? styles.deleteButtonHover : ""}
          >
            {portainerPage.deletingImages
              ? `Deleting ${portainerPage.selectedImages.size}...`
              : `Delete Selected (${portainerPage.selectedImages.size})`}
          </Button>
        </>
      );
    }

    return null;
  }, [
    selectableContainersCount,
    containersWithUpdates,
    allSelectableSelected,
    handleBatchUpgradeClick,
    handleBatchDeleteClick,
    portainerPage,
  ]);

  return (
    <div className={styles.portainerPage}>
      <div className={styles.summaryHeader}>
        <div className={styles.headerContent}>
          <h2 className={styles.portainerHeader}>Portainer</h2>
          <div className={styles.headerLeft}>
            <SearchInput
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search containers..."
              className={styles.searchInput}
            />
          </div>
          <div className={styles.headerActions}>
            {toolbarActions && <div className={styles.toolbarActions}>{toolbarActions}</div>}
            <div className={styles.buttonContainer}>
              {developerModeEnabled && (
                <Button
                  onClick={handlePullPortainerOnly}
                  disabled={pullingPortainerOnly || portainerInstances.length === 0}
                  title={
                    pullingPortainerOnly
                      ? "Updating Portainer data..."
                      : "Update Portainer data only (no Docker Hub)"
                  }
                  variant="outline"
                  icon={RotateCw}
                  size="sm"
                  style={{ 
                    backgroundColor: "var(--warning-light)", 
                    borderColor: "var(--warning)",
                    minHeight: "32px",
                    padding: "6px 10px"
                  }}
                >
                  {""}
                </Button>
              )}
              <Button
                onClick={onPullDockerHub}
                disabled={pullingDockerHub || portainerInstances.length === 0}
                title={pullingDockerHub ? "Checking for updates..." : "Check for updates"}
                variant="outline"
                icon={RefreshCw}
                size="sm"
              >
                {pullingDockerHub ? "Checking for Updates..." : "Check for Updates"}
              </Button>
              {showCheckmark && <Check className={styles.checkmark} size={20} />}
            </div>
          </div>
        </div>
      </div>

      {(pullingDockerHub || pullingPortainerOnly || localPullError) && (
        <div className={styles.alertContainer}>
          {pullingDockerHub && (
            <Alert variant="info" className={styles.alert}>
              <div className={styles.pullStatusContent}>
                <div className={styles.pullSpinner}>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                </div>
                <div className={styles.pullStatusText}>
                  <strong>Pulling fresh data from Docker Hub...</strong>
                  <span>This may take a few moments</span>
                </div>
              </div>
            </Alert>
          )}
          {pullingPortainerOnly && (
            <Alert variant="info" className={styles.alert}>
              <div className={styles.pullStatusContent}>
                <div className={styles.pullSpinner}>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                </div>
                <div className={styles.pullStatusText}>
                  <strong>Updating Portainer data...</strong>
                  <span>Fetching container information from Portainer</span>
                </div>
              </div>
            </Alert>
          )}
          {!pullingDockerHub && !pullingPortainerOnly && localPullError && (
            <Alert variant="error" className={styles.alert}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                <span>{localPullError}</span>
                <button
                  onClick={() => setLocalPullError("")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    fontSize: "18px",
                    padding: "0 8px",
                    marginLeft: "12px",
                  }}
                  aria-label="Dismiss error"
                >
                  ×
                </button>
              </div>
            </Alert>
          )}
        </div>
      )}

      <div className={styles.portainerSidebarLayout}>
        <ErrorBoundary>
          <PortainerSidebar
            portainerInstances={portainerPage.sortedPortainerInstances}
            contentTab={portainerPage.contentTab}
            onContentTabChange={portainerPage.setContentTab}
            selectedPortainerInstances={portainerPage.selectedPortainerInstances}
            onSelectedPortainerInstancesChange={portainerPage.setSelectedPortainerInstances}
            onAddInstance={onAddInstance}
          />
        </ErrorBoundary>

        <div className={styles.portainerContentArea}>
          {portainerInstances.length === 0 ? (
            <EmptyState
              message="No Portainer instances configured. Add one using the + button in the sidebar."
              className={styles.emptyState}
            />
          ) : (
            <>
              {portainerPage.aggregatedContainers.isLoading && (
                <LoadingSpinner
                  size="sm"
                  message="Loading data..."
                  className={styles.loadingIndicator}
                />
              )}

              {/* Tab Content */}
              <div
                className={styles.contentTabPanel}
                role="tabpanel"
                id={`${portainerPage.contentTab}-panel`}
                aria-labelledby={`${portainerPage.contentTab}-tab`}
              >
                <ErrorBoundary>
                  {(portainerPage.contentTab === PORTAINER_CONTENT_TABS.UPDATES ||
                    portainerPage.contentTab === PORTAINER_CONTENT_TABS.CURRENT) && (
                    <ContainersTab
                      groupedStacks={filteredGroupedStacks}
                      isLoading={portainerPage.aggregatedContainers.isLoading}
                      hasData={hasData}
                      showUpdates={portainerPage.contentTab === PORTAINER_CONTENT_TABS.UPDATES}
                      dockerHubDataPulled={portainerPage.dockerHubDataPulled}
                      lastPullTime={portainerPage.lastPullTime}
                      collapsedStacks={portainerPage.collapsedStacks}
                      selectedContainers={portainerPage.selectedContainers}
                      upgrading={portainerPage.upgrading}
                      isPortainerContainer={portainerPage.isPortainerContainer}
                      onToggleStack={portainerPage.toggleStack}
                      onToggleSelect={portainerPage.handleToggleSelect}
                      onUpgrade={portainerPage.handleUpgrade}
                      developerModeEnabled={developerModeEnabled}
                    />
                  )}

                  {portainerPage.contentTab === PORTAINER_CONTENT_TABS.ALL && (
                    <ContainersTab
                      groupedStacks={filteredGroupedStacks}
                      isLoading={portainerPage.aggregatedContainers.isLoading}
                      hasData={hasData}
                      showUpdates={null}
                      showAll={true}
                      dockerHubDataPulled={portainerPage.dockerHubDataPulled}
                      lastPullTime={portainerPage.lastPullTime}
                      collapsedStacks={portainerPage.collapsedStacks}
                      selectedContainers={portainerPage.selectedContainers}
                      upgrading={portainerPage.upgrading}
                      isPortainerContainer={portainerPage.isPortainerContainer}
                      onToggleStack={portainerPage.toggleStack}
                      onToggleSelect={portainerPage.handleToggleSelect}
                      onUpgrade={portainerPage.handleUpgrade}
                      developerModeEnabled={developerModeEnabled}
                    />
                  )}

                  {portainerPage.contentTab === PORTAINER_CONTENT_TABS.UNUSED && (
                    <UnusedTab
                      unusedImages={portainerPage.portainerUnusedImages}
                      isLoading={portainerPage.aggregatedContainers.isLoading}
                      hasData={hasData}
                      selectedImages={portainerPage.selectedImages}
                      deletingImages={portainerPage.deletingImages}
                      formatBytes={portainerPage.formatBytes}
                      onToggleImageSelect={portainerPage.handleToggleImageSelect}
                      onDeleteImage={portainerPage.handleDeleteImage}
                      executeDeleteImage={portainerPage.executeDeleteImage}
                      onDeleteImages={portainerPage.handleDeleteImages}
                      executeDeleteImages={portainerPage.executeDeleteImages}
                      collapsedUnusedImages={portainerPage.collapsedUnusedImages}
                      onToggleCollapsed={handleToggleCollapsed}
                    />
                  )}
                </ErrorBoundary>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Batch Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={batchDeleteConfirm}
        onClose={() => setBatchDeleteConfirm(false)}
        onConfirm={handleBatchDeleteConfirm}
        title="Delete Images?"
        message={`Delete ${portainerPage.selectedImages.size} selected image(s)? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />

      {/* Error Modal for Container Upgrade Failures */}
      <ErrorModal
        isOpen={errorModal.isOpen}
        onClose={closeErrorModal}
        title={errorModal.title}
        message={errorModal.message}
        containerName={errorModal.containerName}
        details={errorModal.details}
      />

      {/* Upgrade Progress Modal */}
      {portainerPage.upgradeModal.container && (
        <UpgradeProgressModal
          key={`upgrade-modal-${portainerPage.upgradeModal.container.id}`}
          isOpen={portainerPage.upgradeModal.isOpen}
          onClose={portainerPage.closeUpgradeModal}
          containerName={portainerPage.upgradeModal.container?.name}
          container={portainerPage.upgradeModal.container}
          onConfirm={portainerPage.executeUpgrade}
          onSuccess={portainerPage.handleUpgradeSuccess}
          onNavigateToLogs={() => {
            // Close modal first to prevent it from blocking navigation
            portainerPage.closeUpgradeModal();

            // Navigate to settings
            if (onNavigateToSettings) {
              onNavigateToSettings();
            }

            // Set logs tab after a delay to ensure Settings page is rendered
            if (onSetSettingsTab) {
              // Use multiple requestAnimationFrame + setTimeout to ensure Settings page is fully rendered
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  setTimeout(() => {
                    onSetSettingsTab(SETTINGS_TABS.LOGS);
                  }, 200);
                });
              });
            }
          }}
        />
      )}

      {/* Batch Upgrade Progress Modal */}
      {portainerPage.batchUpgradeModal.containers.length > 0 && (
        <BatchUpgradeProgressModal
          isOpen={portainerPage.batchUpgradeModal.isOpen}
          onClose={portainerPage.closeBatchUpgradeModal}
          containers={portainerPage.batchUpgradeModal.containers}
          onConfirm={portainerPage.executeBatchUpgrade}
          onSuccess={portainerPage.handleBatchUpgradeSuccess}
          onNavigateToLogs={() => {
            // Close modal first to prevent it from blocking navigation
            portainerPage.closeBatchUpgradeModal();

            // Navigate to settings
            if (onNavigateToSettings) {
              onNavigateToSettings();
            }

            // Set logs tab after a delay to ensure Settings page is rendered
            if (onSetSettingsTab) {
              // Use multiple requestAnimationFrame + setTimeout to ensure Settings page is fully rendered
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  setTimeout(() => {
                    onSetSettingsTab(SETTINGS_TABS.LOGS);
                  }, 200);
                });
              });
            }
          }}
        />
      )}
    </div>
  );
}

PortainerPage.propTypes = {
  portainerInstances: PropTypes.arrayOf(PropTypes.object).isRequired,
  containers: PropTypes.arrayOf(PropTypes.object).isRequired,
  unusedImages: PropTypes.arrayOf(PropTypes.object).isRequired,
  unusedImagesCount: PropTypes.number.isRequired,
  containersByPortainer: PropTypes.object.isRequired,
  loadingInstances: PropTypes.instanceOf(Set).isRequired,
  dockerHubDataPulled: PropTypes.bool.isRequired,
  lastPullTime: PropTypes.instanceOf(Date),
  successfullyUpdatedContainersRef: PropTypes.object.isRequired,
  onContainersUpdate: PropTypes.func.isRequired,
  onUnusedImagesUpdate: PropTypes.func.isRequired,
  onUnusedImagesCountUpdate: PropTypes.func.isRequired,
  fetchContainers: PropTypes.func.isRequired,
  fetchUnusedImages: PropTypes.func.isRequired,
  onAddInstance: PropTypes.func.isRequired,
  onPullDockerHub: PropTypes.func.isRequired,
  pullingDockerHub: PropTypes.bool,
  pullError: PropTypes.string,
  pullSuccess: PropTypes.string,
  activeTab: PropTypes.string,
  onTabChange: PropTypes.func,
  selectedPortainerInstances: PropTypes.instanceOf(Set),
  onSetSelectedPortainerInstances: PropTypes.func,
  contentTab: PropTypes.string,
  onSetContentTab: PropTypes.func,
  onNavigateToSettings: PropTypes.func,
  onSetSettingsTab: PropTypes.func,
};

PortainerPage.displayName = "PortainerPage";

export default PortainerPage;

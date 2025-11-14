import React, { useCallback, useMemo, useState, useEffect } from "react";
import PropTypes from "prop-types";
import { RefreshCw, Check } from "lucide-react";
import ErrorBoundary from "../components/ErrorBoundary";
import Button from "../components/ui/Button";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import EmptyState from "../components/ui/EmptyState";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Alert from "../components/ui/Alert";
import PortainerSidebar from "../components/portainer/PortainerSidebar";
import ContainersTab from "../components/portainer/ContainersTab";
import UnusedTab from "../components/portainer/UnusedTab";
import { usePortainerPage } from "../hooks/usePortainerPage";
import { PORTAINER_CONTENT_TABS } from "../constants/portainerPage";
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
}) {
  const [localPullError, setLocalPullError] = useState("");
  const [showCheckmark, setShowCheckmark] = useState(false);

  // Show checkmark when pull completes successfully
  useEffect(() => {
    // Only show checkmark when we have success and we're not currently pulling
    if (pullSuccess && !pullingDockerHub) {
      setShowCheckmark(true);
      // Hide checkmark after 3 seconds
      const timer = setTimeout(() => {
        setShowCheckmark(false);
      }, 3000);
      return () => clearTimeout(timer);
    } else if (pullingDockerHub) {
      // Hide checkmark when pulling starts
      setShowCheckmark(false);
    }
  }, [pullSuccess, pullingDockerHub]);

  // Hide checkmark when checking starts
  useEffect(() => {
    if (pullingDockerHub) {
      setShowCheckmark(false);
    }
  }, [pullingDockerHub]);

  useEffect(() => {
    if (pullError) {
      setLocalPullError(pullError);
      setShowCheckmark(false);
    }
  }, [pullError]);
  const portainerPage = usePortainerPage({
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

  const handleToggleCollapsed = useCallback(() => {
    portainerPage.setCollapsedUnusedImages(
      !portainerPage.collapsedUnusedImages
    );
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
  }, [portainerPage.contentTab, portainerPage.groupedStacks, portainerPage.isPortainerContainer]);

  const selectableContainersCount = containersWithUpdates.length;
  const allSelectableSelected =
    selectableContainersCount > 0 &&
    containersWithUpdates.every((c) => portainerPage.selectedContainers.has(c.id));

  // Handle batch upgrade click
  const [batchUpgradeConfirm, setBatchUpgradeConfirm] = useState(false);
  const [batchUpgradeData, setBatchUpgradeData] = useState(null);

  const handleBatchUpgradeClick = useCallback(() => {
    const upgradeData = portainerPage.handleBatchUpgrade();
    if (upgradeData) {
      setBatchUpgradeData(upgradeData);
      setBatchUpgradeConfirm(true);
    }
  }, [portainerPage.handleBatchUpgrade]);

  const handleBatchUpgradeConfirm = useCallback(async () => {
    if (batchUpgradeData?.containers) {
      await portainerPage.executeBatchUpgrade(batchUpgradeData.containers);
      setBatchUpgradeConfirm(false);
      setBatchUpgradeData(null);
    }
  }, [batchUpgradeData, portainerPage.executeBatchUpgrade]);

  // Handle batch delete for unused images
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);

  const handleBatchDeleteClick = useCallback(() => {
    const deleteData = portainerPage.handleDeleteImages();
    if (deleteData) {
      setBatchDeleteConfirm(true);
    }
  }, [portainerPage.handleDeleteImages]);

  const handleBatchDeleteConfirm = useCallback(async () => {
    const deleteData = portainerPage.handleDeleteImages();
    if (deleteData?.images) {
      await portainerPage.executeDeleteImages(deleteData.images);
      setBatchDeleteConfirm(false);
    }
  }, [portainerPage.handleDeleteImages, portainerPage.executeDeleteImages]);

  // Toolbar actions based on active tab
  const toolbarActions = useMemo(() => {
    if (portainerPage.contentTab === PORTAINER_CONTENT_TABS.UPDATES && selectableContainersCount > 0) {
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
            {allSelectableSelected ? "Deselect All" : "Select All"}
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
    
    if (portainerPage.contentTab === PORTAINER_CONTENT_TABS.UNUSED && portainerPage.portainerUnusedImages.length > 0) {
      const allImagesSelected = portainerPage.portainerUnusedImages.length > 0 &&
        portainerPage.portainerUnusedImages.every((img) => portainerPage.selectedImages.has(img.id));
      
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
            {allImagesSelected ? "Deselect All" : "Select All"}
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
    portainerPage.contentTab,
    selectableContainersCount,
    containersWithUpdates,
    allSelectableSelected,
    portainerPage.selectedContainers,
    portainerPage.batchUpgrading,
    portainerPage.selectedImages,
    portainerPage.deletingImages,
    portainerPage.portainerUnusedImages,
    portainerPage.handleToggleSelect,
    portainerPage.handleToggleImageSelect,
    handleBatchUpgradeClick,
    handleBatchDeleteClick,
  ]);

  if (portainerInstances.length === 0) {
    return (
      <EmptyState
        message="No Portainer instances configured. Add one using the + button in the sidebar."
        className={styles.emptyState}
      />
    );
  }

  return (
    <div className={styles.portainerPage}>
      <div className={styles.summaryHeader}>
        <div className={styles.headerContent}>
          <h2 className={styles.portainerHeader}>Portainer Instances</h2>
          <div className={styles.headerActions}>
            {toolbarActions && (
              <div className={styles.toolbarActions}>
                {toolbarActions}
              </div>
            )}
            <div className={styles.buttonContainer}>
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
              {showCheckmark && (
                <Check className={styles.checkmark} size={20} />
              )}
            </div>
          </div>
        </div>
      </div>

      {(pullingDockerHub || localPullError) && (
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
          {!pullingDockerHub && localPullError && (
            <Alert variant="error" className={styles.alert}>
              {localPullError}
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
            onSelectedPortainerInstancesChange={
              portainerPage.setSelectedPortainerInstances
            }
            onAddInstance={onAddInstance}
          />
        </ErrorBoundary>

        <div className={styles.portainerContentArea}>
          {portainerPage.aggregatedContainers.isLoading && (
            <LoadingSpinner size="sm" message="Loading data..." className={styles.loadingIndicator} />
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
                  groupedStacks={portainerPage.groupedStacks}
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
        </div>
      </div>

      {/* Batch Upgrade Confirm Dialog */}
      <ConfirmDialog
        isOpen={batchUpgradeConfirm}
        onClose={() => {
          setBatchUpgradeConfirm(false);
          setBatchUpgradeData(null);
        }}
        onConfirm={handleBatchUpgradeConfirm}
        title="Upgrade Containers?"
        message={`Upgrade ${batchUpgradeData?.containerCount || 0} selected container(s)?`}
        confirmText="Upgrade"
        cancelText="Cancel"
        variant="primary"
      />

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
    };

PortainerPage.displayName = "PortainerPage";

export default PortainerPage;


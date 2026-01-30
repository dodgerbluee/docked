import React, { useCallback, useMemo, useState, useEffect } from "react";
import PropTypes from "prop-types";
import { computeHasUpdate } from "../utils/containerUpdateHelpers";
import ErrorModal from "../components/ErrorModal";
import ErrorBoundary from "../components/ErrorBoundary";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import EmptyState from "../components/ui/EmptyState";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import PortainerSidebar from "../components/portainer/PortainerSidebar";
import ContainersTab from "../components/portainer/ContainersTab";
import UnusedTab from "../components/portainer/UnusedTab";
import UpgradeHistoryTab from "../components/portainer/UpgradeHistoryTab";
import ContainerDebugModal from "../components/portainer/ContainerDebugModal";
import UpgradeProgressModal from "../components/ui/UpgradeProgressModal";
import { usePortainerPage } from "../hooks/usePortainerPage";
import { PORTAINER_CONTENT_TABS } from "../constants/portainerPage";
import styles from "./PortainerPage.module.css";
import PortainerHeader from "./PortainerPage/components/PortainerHeader";
import PortainerStatusAlerts from "./PortainerPage/components/PortainerStatusAlerts";
import PortainerToolbarActions from "./PortainerPage/components/PortainerToolbarActions";
import { usePortainerDeveloperMode } from "./PortainerPage/hooks/usePortainerDeveloperMode";
import { usePortainerPullStatus } from "./PortainerPage/hooks/usePortainerPullStatus";
import { usePortainerSearch } from "./PortainerPage/hooks/usePortainerSearch";

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
  portainerUpgradeFromProps = null,
  onNavigateToLogs = null,
  onNavigateToAnalytics = null,
}) {
  // Use extracted hooks
  const { developerModeEnabled } = usePortainerDeveloperMode();

  // Check if modal should open after navigation from welcome page
  useEffect(() => {
    const shouldOpenModal = sessionStorage.getItem("openPortainerModal") === "true";
    if (shouldOpenModal && onAddInstance) {
      sessionStorage.removeItem("openPortainerModal");
      // Small delay to ensure page is fully rendered
      setTimeout(() => {
        onAddInstance();
      }, 100);
    }
  }, [onAddInstance]);

  const { localPullError, showCheckmark, pullingPortainerOnly, handleDismissError } =
    usePortainerPullStatus({
      pullingDockerHub,
      pullSuccess,
      pullError,
      fetchContainers,
    });

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
    portainerUpgradeFromProps,
  });

  // Image source filter state
  const [selectedImageSourceFilters, setSelectedImageSourceFilters] = useState(new Set());

  // Debug modal state - centralized at page level for better performance
  const [debugModalContainer, setDebugModalContainer] = useState(null);

  // Use extracted search hook
  const { searchQuery, setSearchQuery, filteredGroupedStacks } = usePortainerSearch(
    portainerPage.groupedStacks,
    selectedImageSourceFilters
  );

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
      stack.containers.filter((c) => computeHasUpdate(c) && !portainerPage.isPortainerContainer(c))
    );
  }, [portainerPage]);

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

  // Use extracted toolbar actions component
  const toolbarActions = (
    <PortainerToolbarActions
      contentTab={portainerPage.contentTab}
      containersWithUpdates={containersWithUpdates}
      selectedContainers={portainerPage.selectedContainers}
      selectedImages={portainerPage.selectedImages}
      portainerUnusedImages={portainerPage.portainerUnusedImages}
      batchUpgrading={portainerPage.batchUpgrading}
      deletingImages={portainerPage.deletingImages}
      onToggleSelect={portainerPage.handleToggleSelect}
      onToggleImageSelect={portainerPage.handleToggleImageSelect}
      onBatchUpgrade={handleBatchUpgradeClick}
      onBatchDelete={handleBatchDeleteClick}
    />
  );

  return (
    <div className={styles.portainerPage}>
      <PortainerHeader
        searchQuery={searchQuery}
        onSearchChange={(e) => setSearchQuery(e.target.value)}
        onPullDockerHub={onPullDockerHub}
        pullingDockerHub={pullingDockerHub}
        showCheckmark={showCheckmark}
        portainerInstancesCount={portainerInstances.length}
        toolbarActions={toolbarActions}
        onNavigateToAnalytics={onNavigateToAnalytics}
      />

      <PortainerStatusAlerts
        pullingDockerHub={pullingDockerHub}
        pullingPortainerOnly={pullingPortainerOnly}
        localPullError={localPullError}
        onDismissError={handleDismissError}
      />

      <div className={styles.portainerSidebarLayout}>
        <ErrorBoundary>
          <PortainerSidebar
            portainerInstances={portainerPage.sortedPortainerInstances}
            contentTab={portainerPage.contentTab}
            onContentTabChange={portainerPage.setContentTab}
            selectedPortainerInstances={portainerPage.selectedPortainerInstances}
            onSelectedPortainerInstancesChange={portainerPage.setSelectedPortainerInstances}
            selectedImageSourceFilters={selectedImageSourceFilters}
            onSelectedImageSourceFiltersChange={setSelectedImageSourceFilters}
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
                      onOpenDebugModal={setDebugModalContainer}
                      activeUpgrades={portainerPage.activeUpgrades}
                      dismissActiveUpgrade={portainerPage.dismissActiveUpgrade}
                      onNavigateToLogs={onNavigateToLogs}
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
                      onOpenDebugModal={setDebugModalContainer}
                      activeUpgrades={portainerPage.activeUpgrades}
                      dismissActiveUpgrade={portainerPage.dismissActiveUpgrade}
                      onNavigateToLogs={onNavigateToLogs}
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

                  {portainerPage.contentTab === PORTAINER_CONTENT_TABS.HISTORY && (
                    <UpgradeHistoryTab />
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

      {/* Single-container upgrade confirm – same text/details as old popup; on Upgrade, close and show progress in Updating section */}
      <UpgradeProgressModal
        isOpen={!!portainerPage.upgradeConfirmContainer}
        onClose={portainerPage.closeUpgradeConfirm}
        containerName={portainerPage.upgradeConfirmContainer?.name ?? ""}
        container={portainerPage.upgradeConfirmContainer}
        onConfirm={() => {}}
        showProgressInPage={true}
        onConfirmForBanner={(container) =>
          portainerPage.confirmAndStartUpgrade(container)
        }
        onNavigateToLogs={onNavigateToLogs}
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

      {/* Container Debug Modal - Centralized at page level */}
      {debugModalContainer && (
        <ContainerDebugModal
          containerId={debugModalContainer.id}
          containerName={debugModalContainer.name}
          onClose={() => setDebugModalContainer(null)}
          developerModeEnabled={developerModeEnabled}
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
  portainerUpgradeFromProps: PropTypes.object,
  onNavigateToLogs: PropTypes.func,
  onNavigateToAnalytics: PropTypes.func,
};

PortainerPage.displayName = "PortainerPage";

export default PortainerPage;

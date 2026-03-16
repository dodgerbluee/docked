import React, { useCallback, useMemo, useState, useEffect } from "react";
import PropTypes from "prop-types";
import { computeHasUpdate } from "../utils/containerUpdateHelpers";
import ErrorModal from "../components/ErrorModal";
import ErrorBoundary from "../components/ErrorBoundary";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import EmptyState from "../components/ui/EmptyState";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import MobileDrawer from "../components/ui/MobileDrawer";
import SourcesSidebar from "../components/containers/SourcesSidebar";
import ContainersTab from "../components/containers/ContainersTab";
import UnusedTab from "../components/containers/UnusedTab";
import UpgradeHistoryTab from "../components/containers/UpgradeHistoryTab";
import ContainerDebugModal from "../components/containers/ContainerDebugModal";
import UpgradeProgressModal from "../components/ui/UpgradeProgressModal";
import BatchUpgradeProgressModal from "../components/ui/BatchUpgradeProgressModal";
import { useContainersPage } from "../hooks/useContainersPage";
import { useIsMobile } from "../hooks/useIsMobile";
import { CONTAINERS_CONTENT_TABS } from "../constants/containersPage";
import styles from "./ContainersPage.module.css";
import ContainersHeader from "./ContainersPage/components/ContainersHeader";
import ContainersStatusAlerts from "./ContainersPage/components/ContainersStatusAlerts";
import ContainersToolbarActions from "./ContainersPage/components/ContainersToolbarActions";
import { useDeveloperMode } from "./ContainersPage/hooks/useDeveloperMode";
import { usePullStatus } from "./ContainersPage/hooks/usePullStatus";
import { useContainersSearch } from "./ContainersPage/hooks/useContainersSearch";

/**
 * ContainersPage Component
 * Main page component for the Sources section with tab navigation
 */
function ContainersPage({
  sourceInstances = [],
  containers = [],
  unusedImages = [],
  unusedImagesCount = 0,
  containersBySource = {},
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
  selectedSourceInstances: controlledSelectedSourceInstances,
  onSetSelectedSourceInstances,
  contentTab: controlledContentTab,
  onSetContentTab,
  containerUpgradeFromProps = null,
  onNavigateToLogs = null,
  onManageSources = null,
  onManageIntents = null,
}) {
  // Use extracted hooks
  const { developerModeEnabled } = useDeveloperMode();

  // Check if modal should open after navigation from welcome page
  useEffect(() => {
    const shouldOpenModal = sessionStorage.getItem("openSourceModal") === "true";
    if (shouldOpenModal && onAddInstance) {
      sessionStorage.removeItem("openSourceModal");
      // Small delay to ensure page is fully rendered
      setTimeout(() => {
        onAddInstance();
      }, 100);
    }
  }, [onAddInstance]);

  const { localPullError, showCheckmark, pullingSourcesOnly, handleDismissError } =
    usePullStatus({
      pullingDockerHub,
      pullSuccess,
      pullError,
      fetchContainers,
    });

  const { errorModal, closeErrorModal, ...containersPage } = useContainersPage({
    sourceInstances,
    containers,
    unusedImages,
    unusedImagesCount,
    containersBySource,
    loadingInstances,
    dockerHubDataPulled,
    lastPullTime,
    successfullyUpdatedContainersRef,
    onContainersUpdate,
    onUnusedImagesUpdate,
    onUnusedImagesCountUpdate,
    fetchContainers,
    fetchUnusedImages,
    selectedSourceInstances: controlledSelectedSourceInstances,
    onSetSelectedSourceInstances,
    contentTab: controlledContentTab,
    onSetContentTab,
    containerUpgradeFromProps,
  });

  // Image source filter state
  const [selectedImageSourceFilters, setSelectedImageSourceFilters] = useState(new Set());

  // Mobile-only sidebar drawer state (MobileDrawer handles escape, scroll lock, focus trap)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  const openMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(true);
  }, []);

  // Debug modal state - centralized at page level for better performance
  const [debugModalContainer, setDebugModalContainer] = useState(null);

  // Use extracted search hook
  const { searchQuery, setSearchQuery, filteredGroupedStacks } = useContainersSearch(
    containersPage.groupedStacks,
    selectedImageSourceFilters
  );

  const handleToggleCollapsed = useCallback(() => {
    containersPage.setCollapsedUnusedImages(!containersPage.collapsedUnusedImages);
  }, [containersPage]);

  // Check if we have any data at all
  const hasData =
    containersPage.aggregatedContainers.all.length > 0 ||
    containersPage.sourceUnusedImages.length > 0;

  // Calculate containers with updates for toolbar buttons
  const containersWithUpdates = useMemo(() => {
    if (containersPage.contentTab !== CONTAINERS_CONTENT_TABS.UPDATES) {
      return [];
    }
    return containersPage.groupedStacks.flatMap((stack) =>
      stack.containers.filter((c) => computeHasUpdate(c) && !containersPage.isPortainerContainer(c))
    );
  }, [containersPage]);

  // Handle batch upgrade click - now opens modal directly
  const handleBatchUpgradeClick = useCallback(() => {
    containersPage.handleBatchUpgrade();
  }, [containersPage]);

  // Handle batch delete for unused images
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);

  const handleBatchDeleteClick = useCallback(() => {
    const deleteData = containersPage.handleDeleteImages();
    if (deleteData) {
      setBatchDeleteConfirm(true);
    }
  }, [containersPage]);

  const handleBatchDeleteConfirm = useCallback(async () => {
    const deleteData = containersPage.handleDeleteImages();
    if (deleteData?.images) {
      await containersPage.executeDeleteImages(deleteData.images);
      setBatchDeleteConfirm(false);
    }
  }, [containersPage]);

  const toolbarActions = (
    <ContainersToolbarActions
      contentTab={containersPage.contentTab}
      containersWithUpdates={containersWithUpdates}
      selectedContainers={containersPage.selectedContainers}
      selectedImages={containersPage.selectedImages}
      sourceUnusedImages={containersPage.sourceUnusedImages}
      batchUpgrading={containersPage.batchUpgrading}
      deletingImages={containersPage.deletingImages}
      onToggleSelect={containersPage.handleToggleSelect}
      onToggleImageSelect={containersPage.handleToggleImageSelect}
      onBatchUpgrade={handleBatchUpgradeClick}
      onBatchDelete={handleBatchDeleteClick}
      compactLabels={isMobile}
    />
  );

  return (
    <div className={styles.containersPage}>
      <ContainersHeader
        searchQuery={searchQuery}
        onSearchChange={(e) => setSearchQuery(e.target.value)}
        onPullDockerHub={onPullDockerHub}
        pullingDockerHub={pullingDockerHub}
        showCheckmark={showCheckmark}
        sourceInstancesCount={sourceInstances.length}
        toolbarActions={toolbarActions}
        mobileSidebarOpen={mobileSidebarOpen}
        onMobileSidebarOpen={openMobileSidebar}
      />

      <ContainersStatusAlerts
        pullingDockerHub={pullingDockerHub}
        pullingSourcesOnly={pullingSourcesOnly}
        localPullError={localPullError}
        onDismissError={handleDismissError}
      />

      <div className={styles.sourcesSidebarLayout}>
        {/* Desktop: render sidebar inline */}
        {!isMobile && (
          <ErrorBoundary>
            <div
              className={styles.sourcesSidebar}
              role="complementary"
              aria-label="Container filters"
            >
              <SourcesSidebar
                sourceInstances={containersPage.sortedSourceInstances}
                contentTab={containersPage.contentTab}
                onContentTabChange={(tab) => {
                  containersPage.setContentTab(tab);
                }}
                selectedSourceInstances={containersPage.selectedSourceInstances}
                onSelectedSourceInstancesChange={(next) => {
                  containersPage.setSelectedSourceInstances(next);
                }}
                selectedImageSourceFilters={selectedImageSourceFilters}
                onSelectedImageSourceFiltersChange={(next) => {
                  setSelectedImageSourceFilters(next);
                }}
                onManageSources={onManageSources}
                onManageIntents={onManageIntents}
              />
            </div>
          </ErrorBoundary>
        )}

        {/* Mobile: render sidebar in shared MobileDrawer */}
        <MobileDrawer
          isOpen={mobileSidebarOpen}
          onClose={closeMobileSidebar}
          title="Filters"
          ariaLabel="Container filters"
        >
          <ErrorBoundary>
            <SourcesSidebar
              sourceInstances={containersPage.sortedSourceInstances}
              contentTab={containersPage.contentTab}
              onContentTabChange={(tab) => {
                containersPage.setContentTab(tab);
                closeMobileSidebar();
              }}
              selectedSourceInstances={containersPage.selectedSourceInstances}
              onSelectedSourceInstancesChange={(next) => {
                containersPage.setSelectedSourceInstances(next);
              }}
              selectedImageSourceFilters={selectedImageSourceFilters}
              onSelectedImageSourceFiltersChange={(next) => {
                setSelectedImageSourceFilters(next);
              }}
              onManageSources={
                onManageSources
                  ? () => {
                      closeMobileSidebar();
                      onManageSources();
                    }
                  : null
              }
              onManageIntents={
                onManageIntents
                  ? () => {
                      closeMobileSidebar();
                      onManageIntents();
                    }
                  : null
              }
            />
          </ErrorBoundary>
        </MobileDrawer>

        <div className={styles.containersContentArea}>
          {sourceInstances.length === 0 ? (
            <EmptyState
              message="No source instances configured. Add one using the + button in the sidebar."
              className={styles.emptyState}
            />
          ) : (
            <>
              {containersPage.aggregatedContainers.isLoading && (
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
                id={`${containersPage.contentTab}-panel`}
                aria-labelledby={`${containersPage.contentTab}-tab`}
              >
                <ErrorBoundary>
                  {(containersPage.contentTab === CONTAINERS_CONTENT_TABS.UPDATES ||
                    containersPage.contentTab === CONTAINERS_CONTENT_TABS.CURRENT) && (
                    <ContainersTab
                      groupedStacks={filteredGroupedStacks}
                      isLoading={containersPage.aggregatedContainers.isLoading}
                      hasData={hasData}
                      showUpdates={containersPage.contentTab === CONTAINERS_CONTENT_TABS.UPDATES}
                      dockerHubDataPulled={containersPage.dockerHubDataPulled}
                      lastPullTime={containersPage.lastPullTime}
                      collapsedStacks={containersPage.collapsedStacks}
                      selectedContainers={containersPage.selectedContainers}
                      upgrading={containersPage.upgrading}
                      isPortainerContainer={containersPage.isPortainerContainer}
                      getBlockedMessage={containersPage.getBlockedMessage}
                      onToggleStack={containersPage.toggleStack}
                      onToggleSelect={containersPage.handleToggleSelect}
                      onUpgrade={containersPage.handleUpgrade}
                      developerModeEnabled={developerModeEnabled}
                      onOpenDebugModal={setDebugModalContainer}
                      activeUpgrades={containersPage.activeUpgrades}
                      dismissActiveUpgrade={containersPage.dismissActiveUpgrade}
                      onNavigateToLogs={onNavigateToLogs}
                    />
                  )}

                  {containersPage.contentTab === CONTAINERS_CONTENT_TABS.ALL && (
                    <ContainersTab
                      groupedStacks={filteredGroupedStacks}
                      isLoading={containersPage.aggregatedContainers.isLoading}
                      hasData={hasData}
                      showUpdates={null}
                      showAll={true}
                      dockerHubDataPulled={containersPage.dockerHubDataPulled}
                      lastPullTime={containersPage.lastPullTime}
                      collapsedStacks={containersPage.collapsedStacks}
                      selectedContainers={containersPage.selectedContainers}
                      upgrading={containersPage.upgrading}
                      isPortainerContainer={containersPage.isPortainerContainer}
                      getBlockedMessage={containersPage.getBlockedMessage}
                      onToggleStack={containersPage.toggleStack}
                      onToggleSelect={containersPage.handleToggleSelect}
                      onUpgrade={containersPage.handleUpgrade}
                      developerModeEnabled={developerModeEnabled}
                      onOpenDebugModal={setDebugModalContainer}
                      activeUpgrades={containersPage.activeUpgrades}
                      dismissActiveUpgrade={containersPage.dismissActiveUpgrade}
                      onNavigateToLogs={onNavigateToLogs}
                    />
                  )}

                  {containersPage.contentTab === CONTAINERS_CONTENT_TABS.UNUSED && (
                    <UnusedTab
                      unusedImages={containersPage.sourceUnusedImages}
                      isLoading={containersPage.aggregatedContainers.isLoading}
                      hasData={hasData}
                      selectedImages={containersPage.selectedImages}
                      deletingImages={containersPage.deletingImages}
                      formatBytes={containersPage.formatBytes}
                      onToggleImageSelect={containersPage.handleToggleImageSelect}
                      onDeleteImage={containersPage.handleDeleteImage}
                      executeDeleteImage={containersPage.executeDeleteImage}
                      onDeleteImages={containersPage.handleDeleteImages}
                      executeDeleteImages={containersPage.executeDeleteImages}
                      collapsedUnusedImages={containersPage.collapsedUnusedImages}
                      onToggleCollapsed={handleToggleCollapsed}
                    />
                  )}

                  {containersPage.contentTab === CONTAINERS_CONTENT_TABS.HISTORY && (
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
        message={`Delete ${containersPage.selectedImages.size} selected image(s)? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />

      {/* Batch upgrade confirm – same look as before; on Upgrade, close and queue in Updating section (no second page) */}
      <BatchUpgradeProgressModal
        isOpen={(containersPage.batchUpgradeConfirmContainers?.length ?? 0) > 0}
        onClose={containersPage.closeBatchUpgradeConfirm}
        containers={containersPage.batchUpgradeConfirmContainers ?? []}
        onConfirm={() => {}}
        showProgressInPage={true}
        onConfirmForBanner={(containers) =>
          containersPage.confirmAndStartBatchUpgrade(containers, containersPage.setSelectedContainers)
        }
        onNavigateToLogs={onNavigateToLogs}
      />

      {/* Single-container upgrade confirm – same text/details as old popup; on Upgrade, close and show progress in Updating section */}
      <UpgradeProgressModal
        isOpen={!!containersPage.upgradeConfirmContainer}
        onClose={containersPage.closeUpgradeConfirm}
        containerName={containersPage.upgradeConfirmContainer?.name ?? ""}
        container={containersPage.upgradeConfirmContainer}
        onConfirm={() => {}}
        showProgressInPage={true}
        onConfirmForBanner={(container) => containersPage.confirmAndStartUpgrade(container)}
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

ContainersPage.propTypes = {
  sourceInstances: PropTypes.arrayOf(PropTypes.object).isRequired,
  containers: PropTypes.arrayOf(PropTypes.object).isRequired,
  unusedImages: PropTypes.arrayOf(PropTypes.object).isRequired,
  unusedImagesCount: PropTypes.number.isRequired,
  containersBySource: PropTypes.object.isRequired,
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
  selectedSourceInstances: PropTypes.instanceOf(Set),
  onSetSelectedSourceInstances: PropTypes.func,
  contentTab: PropTypes.string,
  onSetContentTab: PropTypes.func,
  containerUpgradeFromProps: PropTypes.object,
  onNavigateToLogs: PropTypes.func,
  onManageSources: PropTypes.func,
  onManageIntents: PropTypes.func,
};

ContainersPage.displayName = "ContainersPage";

export default ContainersPage;

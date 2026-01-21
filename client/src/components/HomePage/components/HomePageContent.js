/**
 * HomePage content component
 */

import React, { useCallback, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import TabNavigation from "../../TabNavigation/TabNavigation";
import RateLimitError from "../../ErrorDisplay/RateLimitError";
import SummaryPage from "../../../pages/SummaryPage";
import TrackedAppsPage from "../../../pages/TrackedAppsPage";
import PortainerPage from "../../../pages/PortainerPage";
import SettingsPage from "../../../pages/SettingsPage";
import BatchPage from "../../../pages/BatchPage";
import AdminPage from "../../../pages/AdminPage";
import { TAB_NAMES, CONTENT_TABS } from "../../../constants/apiConstants";
import { SETTINGS_TABS } from "../../../constants/settings";

/**
 * HomePage content component
 * @param {Object} props
 */
const HomePageContent = ({
  activeTab,
  contentTab,
  settingsTab,
  configurationTab,
  containers,
  containersWithUpdates,
  trackedAppsBehind,
  loading,
  pulling,
  error,
  pullError,
  pullSuccess,
  dockerHubCredentials,
  portainerInstances,
  unusedImages,
  unusedImagesCount,
  trackedApps,
  dismissedTrackedAppNotifications,
  containersByPortainer,
  loadingInstances,
  dockerHubDataPulled,
  lastPullTime,
  successfullyUpdatedContainersRef,
  selectedPortainerInstances,
  username,
  authToken,
  avatar,
  recentAvatars,
  colorScheme,
  batchConfig,
  setActiveTab,
  setContentTab,
  setSettingsTab,
  setConfigurationTab,
  setSelectedPortainerInstances,
  setError,
  setContainers,
  setUnusedImages,
  setUnusedImagesCount,
  fetchContainers,
  fetchUnusedImages,
  fetchTrackedApps,
  openModal,
  handlePull,
  handleBatchPull,
  handleBatchTrackedAppsCheck,
  handleUsernameUpdate,
  handlePasswordUpdateSuccessWithNavigation,
  handlePortainerInstancesChange,
  handleAvatarChange,
  handleRecentAvatarsChange,
  handleAvatarUploaded,
  handleBatchConfigUpdate,
  handleColorSchemeChange,
  handleClear,
  handleClearGitHubCache,
  handleLogoutWithCleanup,
  editingPortainerInstance,
  fetchPortainerInstances,
}) => {
  // Render summary page
  const renderSummary = useCallback(() => {
    const isLoading = loading;
    return (
      <SummaryPage
        portainerInstances={portainerInstances}
        containers={containers}
        unusedImages={unusedImages}
        unusedImagesCount={unusedImagesCount}
        trackedApps={trackedApps}
        dismissedTrackedAppNotifications={dismissedTrackedAppNotifications}
        onNavigateToPortainer={() => setActiveTab(TAB_NAMES.PORTAINER)}
        onNavigateToTrackedApps={() => setActiveTab(TAB_NAMES.TRACKED_APPS)}
        onSetSelectedPortainerInstances={setSelectedPortainerInstances}
        onSetContentTab={setContentTab}
        isLoading={isLoading}
        onAddInstance={openModal}
      />
    );
  }, [
    loading,
    containers,
    portainerInstances,
    unusedImages,
    unusedImagesCount,
    trackedApps,
    dismissedTrackedAppNotifications,
    setActiveTab,
    setSelectedPortainerInstances,
    setContentTab,
    openModal,
  ]);

  // Render tracked apps
  const renderTrackedApps = useCallback(() => {
    return (
      <TrackedAppsPage
        onDeleteTrackedApp={fetchTrackedApps}
        onUpgradeTrackedApp={fetchTrackedApps}
        onEditTrackedApp={fetchTrackedApps}
        onNavigateToSettings={() => {
          // Navigate to settings first
          setActiveTab(TAB_NAMES.SETTINGS);
          // Set the Tracked Apps tab after a delay to ensure Settings page is rendered
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setTimeout(() => {
                setSettingsTab(SETTINGS_TABS.TRACKED_APPS);
              }, 200);
            });
          });
        }}
      />
    );
  }, [fetchTrackedApps, setActiveTab, setSettingsTab]);

  // Track previous tab to detect navigation
  const previousTabRef = useRef(activeTab);

  // Automatically refresh containers when navigating to Portainer or Summary tabs
  // This ensures containers are refreshed and update status is re-evaluated
  useEffect(() => {
    const previousTab = previousTabRef.current;
    const currentTab = activeTab;

    // Only refresh if we're navigating TO Portainer or Summary (not FROM them)
    // This prevents unnecessary refreshes when already on those tabs
    if (
      previousTab !== currentTab &&
      (currentTab === TAB_NAMES.PORTAINER || currentTab === TAB_NAMES.SUMMARY)
    ) {
      // Refresh containers with update status re-evaluation
      // This fetches fresh data from Portainer and re-checks if updates are still needed
      if (fetchContainers) {
        // Use a small delay to avoid refreshing too frequently during rapid navigation
        // But don't delay too much - we want fresh data quickly
        const timeoutId = setTimeout(() => {
          fetchContainers(false, null, true, true); // showLoading=false, instanceUrl=null, portainerOnly=true, refreshUpdates=true
        }, 100); // Reduced delay from 300ms to 100ms for faster refresh

        return () => clearTimeout(timeoutId);
      }
    }

    previousTabRef.current = currentTab;
  }, [activeTab, fetchContainers]);

  return (
    <div className="container">
      {/* Tabs - Show for all tabs except settings, configuration, batch logs, and admin */}
      {activeTab !== TAB_NAMES.SETTINGS &&
        activeTab !== TAB_NAMES.CONFIGURATION &&
        activeTab !== TAB_NAMES.BATCH_LOGS &&
        activeTab !== TAB_NAMES.ADMIN && (
          <TabNavigation
            activeTab={activeTab}
            onTabChange={(tab) => {
              setActiveTab(tab);
              if (tab === TAB_NAMES.PORTAINER) {
                setSelectedPortainerInstances(new Set());
                setContentTab(CONTENT_TABS.UPDATES);
              }
            }}
            containersWithUpdates={containersWithUpdates}
            trackedAppsBehind={trackedAppsBehind}
          />
        )}

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === TAB_NAMES.SETTINGS ? (
          <SettingsPage
            key={username || authToken || "settings"}
            username={username}
            avatar={avatar}
            recentAvatars={recentAvatars || []}
            onUsernameUpdate={handleUsernameUpdate}
            onLogout={handleLogoutWithCleanup}
            onPasswordUpdateSuccess={handlePasswordUpdateSuccessWithNavigation}
            onPortainerInstancesChange={handlePortainerInstancesChange}
            onAvatarChange={handleAvatarChange}
            onRecentAvatarsChange={handleRecentAvatarsChange}
            onAvatarUploaded={handleAvatarUploaded}
            onBatchConfigUpdate={handleBatchConfigUpdate}
            colorScheme={colorScheme}
            onColorSchemeChange={handleColorSchemeChange}
            onClearPortainerData={handleClear}
            onClearTrackedAppData={handleClearGitHubCache}
            onEditInstance={openModal}
            editingPortainerInstance={editingPortainerInstance}
            refreshInstances={editingPortainerInstance === null ? fetchPortainerInstances : null}
            onReturnHome={() => setActiveTab(TAB_NAMES.SUMMARY)}
            activeTab={settingsTab}
            onTabChange={setSettingsTab}
          />
        ) : activeTab === TAB_NAMES.CONFIGURATION ? (
          <BatchPage
            onBatchConfigUpdate={handleBatchConfigUpdate}
            colorScheme={colorScheme}
            onColorSchemeChange={handleColorSchemeChange}
            onReturnHome={() => setActiveTab(TAB_NAMES.SUMMARY)}
            onTriggerBatch={handleBatchPull}
            onTriggerTrackedAppsBatch={handleBatchTrackedAppsCheck}
            activeTab={configurationTab}
            onTabChange={setConfigurationTab}
          />
        ) : activeTab === TAB_NAMES.BATCH_LOGS ? (
          <BatchPage
            onBatchConfigUpdate={handleBatchConfigUpdate}
            colorScheme={colorScheme}
            onColorSchemeChange={handleColorSchemeChange}
            onReturnHome={() => setActiveTab(TAB_NAMES.SUMMARY)}
            onTriggerBatch={handleBatchPull}
            onTriggerTrackedAppsBatch={handleBatchTrackedAppsCheck}
            activeTab="history"
          />
        ) : (
          <>
            {loading && containers.length === 0 && !pulling && (
              <div className="loading">Loading containers...</div>
            )}

            <RateLimitError
              error={error}
              dockerHubCredentials={dockerHubCredentials}
              onDismiss={() => setError(null)}
              onNavigateToDockerHubSettings={() => {
                setError(null);
                setActiveTab(TAB_NAMES.SETTINGS);
                setSettingsTab(SETTINGS_TABS.DOCKERHUB);
              }}
              onRetry={handlePull}
              pulling={pulling}
              loading={loading}
            />

            {!loading && (
              <>
                {activeTab === TAB_NAMES.SUMMARY && renderSummary()}
                {activeTab === TAB_NAMES.PORTAINER && (
                  <PortainerPage
                    portainerInstances={portainerInstances}
                    containers={containers}
                    unusedImages={unusedImages}
                    unusedImagesCount={unusedImagesCount}
                    containersByPortainer={containersByPortainer}
                    loadingInstances={loadingInstances}
                    dockerHubDataPulled={dockerHubDataPulled}
                    lastPullTime={lastPullTime}
                    successfullyUpdatedContainersRef={successfullyUpdatedContainersRef}
                    onContainersUpdate={setContainers}
                    onUnusedImagesUpdate={setUnusedImages}
                    onUnusedImagesCountUpdate={setUnusedImagesCount}
                    fetchContainers={fetchContainers}
                    fetchUnusedImages={fetchUnusedImages}
                    onAddInstance={openModal}
                    onPullDockerHub={handlePull}
                    pullingDockerHub={pulling}
                    pullError={pullError}
                    pullSuccess={pullSuccess}
                    selectedPortainerInstances={selectedPortainerInstances}
                    onSetSelectedPortainerInstances={setSelectedPortainerInstances}
                    contentTab={contentTab}
                    onSetContentTab={setContentTab}
                  />
                )}
                {activeTab === TAB_NAMES.TRACKED_APPS && renderTrackedApps()}
                {activeTab === TAB_NAMES.ADMIN && (
                  <AdminPage onReturnHome={() => setActiveTab(TAB_NAMES.SUMMARY)} />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

HomePageContent.propTypes = {
  activeTab: PropTypes.string.isRequired,
  contentTab: PropTypes.string.isRequired,
  settingsTab: PropTypes.string.isRequired,
  configurationTab: PropTypes.string.isRequired,
  containers: PropTypes.array.isRequired,
  containersWithUpdates: PropTypes.array.isRequired,
  trackedAppsBehind: PropTypes.number.isRequired,
  loading: PropTypes.bool.isRequired,
  pulling: PropTypes.bool.isRequired,
  error: PropTypes.string,
  pullError: PropTypes.string,
  pullSuccess: PropTypes.string,
  dockerHubCredentials: PropTypes.object,
  portainerInstances: PropTypes.array.isRequired,
  unusedImages: PropTypes.array.isRequired,
  unusedImagesCount: PropTypes.number.isRequired,
  trackedApps: PropTypes.array.isRequired,
  dismissedTrackedAppNotifications: PropTypes.object.isRequired,
  containersByPortainer: PropTypes.object.isRequired,
  loadingInstances: PropTypes.instanceOf(Set).isRequired,
  dockerHubDataPulled: PropTypes.bool.isRequired,
  lastPullTime: PropTypes.instanceOf(Date),
  successfullyUpdatedContainersRef: PropTypes.object.isRequired,
  selectedPortainerInstances: PropTypes.instanceOf(Set).isRequired,
  username: PropTypes.string,
  authToken: PropTypes.string,
  avatar: PropTypes.string,
  recentAvatars: PropTypes.array,
  colorScheme: PropTypes.string.isRequired,
  batchConfig: PropTypes.object.isRequired,
  setActiveTab: PropTypes.func.isRequired,
  setContentTab: PropTypes.func.isRequired,
  setSettingsTab: PropTypes.func.isRequired,
  setConfigurationTab: PropTypes.func.isRequired,
  setSelectedPortainerInstances: PropTypes.func.isRequired,
  setError: PropTypes.func.isRequired,
  setContainers: PropTypes.func.isRequired,
  setUnusedImages: PropTypes.func.isRequired,
  setUnusedImagesCount: PropTypes.func.isRequired,
  fetchContainers: PropTypes.func.isRequired,
  fetchUnusedImages: PropTypes.func.isRequired,
  fetchTrackedApps: PropTypes.func.isRequired,
  openModal: PropTypes.func.isRequired,
  handlePull: PropTypes.func.isRequired,
  handleBatchPull: PropTypes.func.isRequired,
  handleBatchTrackedAppsCheck: PropTypes.func.isRequired,
  handleUsernameUpdate: PropTypes.func.isRequired,
  handlePasswordUpdateSuccessWithNavigation: PropTypes.func.isRequired,
  handlePortainerInstancesChange: PropTypes.func.isRequired,
  handleAvatarChange: PropTypes.func.isRequired,
  handleRecentAvatarsChange: PropTypes.func.isRequired,
  handleAvatarUploaded: PropTypes.func.isRequired,
  handleBatchConfigUpdate: PropTypes.func.isRequired,
  handleColorSchemeChange: PropTypes.func.isRequired,
  handleClear: PropTypes.func.isRequired,
  handleClearGitHubCache: PropTypes.func.isRequired,
  handleLogoutWithCleanup: PropTypes.func.isRequired,
  editingPortainerInstance: PropTypes.object,
  fetchPortainerInstances: PropTypes.func.isRequired,
};

export default HomePageContent;

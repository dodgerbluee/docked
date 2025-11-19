/**
 * HomePage content component
 */

import React, { useMemo, useCallback } from "react";
import PropTypes from "prop-types";
import TabNavigation from "../../TabNavigation/TabNavigation";
import RateLimitError from "../../ErrorDisplay/RateLimitError";
import SummaryPage from "../../../pages/SummaryPage";
import TrackedAppsPage from "../../../pages/TrackedAppsPage";
import PortainerPage from "../../../pages/PortainerPage";
import SettingsPage from "../../../pages/SettingsPage";
import BatchPage from "../../../pages/BatchPage";
import AdminPage from "../../../pages/AdminPage";
import { TAB_NAMES, CONTENT_TABS, SETTINGS_TABS } from "../../../constants/apiConstants";

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
  passwordChanged,
  loading,
  pulling,
  error,
  pullError,
  pullSuccess,
  dockerHubCredentials,
  portainerInstances,
  unusedImages,
  unusedImagesCount,
  trackedImages,
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
  fetchTrackedImages,
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
        trackedImages={trackedImages}
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
    trackedImages,
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
        onDeleteTrackedImage={fetchTrackedImages}
        onUpgradeTrackedImage={fetchTrackedImages}
        onEditTrackedImage={fetchTrackedImages}
      />
    );
  }, [fetchTrackedImages]);

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
            passwordChanged={passwordChanged}
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
                {activeTab === TAB_NAMES.ADMIN && <AdminPage />}
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
  passwordChanged: PropTypes.bool.isRequired,
  loading: PropTypes.bool.isRequired,
  pulling: PropTypes.bool.isRequired,
  error: PropTypes.string,
  pullError: PropTypes.string,
  pullSuccess: PropTypes.string,
  dockerHubCredentials: PropTypes.object,
  portainerInstances: PropTypes.array.isRequired,
  unusedImages: PropTypes.array.isRequired,
  unusedImagesCount: PropTypes.number.isRequired,
  trackedImages: PropTypes.array.isRequired,
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
  fetchTrackedImages: PropTypes.func.isRequired,
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


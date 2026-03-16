import React, { lazy, Suspense, useMemo } from "react";
import PropTypes from "prop-types";
import Header from "./Header/Header";
import VersionFooter from "./Footer/VersionFooter";
import { BatchConfigContext } from "../contexts/BatchConfigContext";
import HomePageContent from "./HomePage/components/HomePageContent";
import { computeHasUpdate } from "../utils/containerUpdateHelpers";

const HomePageModals = lazy(() => import("./HomePage/components/HomePageModals"));

/**
 * HomePage Component
 * Main application content after authentication
 */
function HomePage({
  // Auth & User
  username,
  userRole,
  avatar,
  recentAvatars,
  darkMode,
  instanceAdmin,
  authToken,
  // State
  activeTab,
  contentTab,
  settingsTab,
  configurationTab,
  selectedSourceInstances,
  selectedContainers,
  selectedImages,
  collapsedStacks,
  pulling,
  loading,
  error,
  pullError,
  pullSuccess,
  // Data
  containers,
  stacks,
  unusedImages,
  unusedImagesCount,
  trackedApps,
  sourceInstances,
  containersBySource,
  loadingInstances,
  dockerHubDataPulled,
  dataFetched,
  lastPullTime,
  successfullyUpdatedContainersRef,
  sourceInstancesFromAPI,
  // Notifications
  notificationCount,
  activeContainersWithUpdates,
  activeTrackedAppsBehind,
  versionUpdateInfo,
  dismissedTrackedAppNotifications,
  trackedAppsBehind,
  // Menu State
  showAvatarMenu,
  showNotificationMenu,
  toggleAvatarMenu,
  toggleNotificationMenu,
  // Modal State
  showAddSourceModal,
  editingSourceInstance,
  closeModal,
  // Handlers
  setActiveTab,
  setContentTab,
  setSettingsTab,
  setConfigurationTab,
  setSelectedSourceInstances,
  setError,
  handleNavigateToSummary,
  handleNavigateToSettings,
  handleNavigateToBatch,
  handleNavigateToAdmin,
  handleNavigateToContainers,
  handleNavigateToTrackedApps,
  handleDismissContainerNotification,
  handleDismissTrackedAppNotification,
  onDismissVersionUpdateNotification,
  handleTemporaryThemeToggle,
  handleLogoutWithCleanup,
  handleUsernameUpdate,
  handlePasswordUpdateSuccessWithNavigation,
  handleSourceInstancesChange,
  handleAvatarChange,
  handleRecentAvatarsChange,
  handleAvatarUploaded,
  handleBatchConfigUpdate,
  handleClear,
  handleClearGitHubCache,
  handlePull,
  handleUpgrade,
  handleBatchUpgrade,
  handleDeleteImage,
  handleDeleteImages,
  handleToggleSelect,
  handleSelectAll,
  handleToggleImageSelect,
  handleSelectAllImages,
  handleBatchPull,
  handleBatchTrackedAppsCheck,
  handleNewInstanceDataFetch,
  fetchSourceInstances,
  fetchContainers,
  fetchUnusedImages,
  fetchRecentAvatars,
  fetchAvatar,
  fetchTrackedApps,
  setContainers,
  setStacks,
  setUnusedImages,
  setUnusedImagesCount,
  openModal,
  handleModalSuccess,
  colorScheme,
  handleColorSchemeChange,
  batchConfig,
  setBatchConfig,
  version,
  isDevBuild,
  API_BASE_URL,
  draggedTabIndex,
  setDraggedTabIndex,
  handleReorderTabs,
  toggleStack,
  discordWebhooks = [],
  containerUpgrade,
}) {
  // Page visibility settings removed - all pages are now always visible
  // Memoize context value
  const batchConfigContextValue = useMemo(
    () => ({
      batchConfig,
      setBatchConfig,
    }),
    [batchConfig, setBatchConfig]
  );

  // Memoize filtered containers - compute hasUpdate on-the-fly
  const containersWithUpdates = useMemo(
    () => containers.filter((c) => computeHasUpdate(c)),
    [containers]
  );

  return (
    <BatchConfigContext.Provider value={batchConfigContextValue}>
      <div className="App">
        <Header
          username={username}
          userRole={userRole}
          avatar={avatar}
          darkMode={darkMode}
          showAvatarMenu={showAvatarMenu}
          onToggleAvatarMenu={toggleAvatarMenu}
          instanceAdmin={instanceAdmin}
          onNavigateToSummary={handleNavigateToSummary}
          onNavigateToSettings={handleNavigateToSettings}
          onNavigateToBatch={handleNavigateToBatch}
          onNavigateToAdmin={handleNavigateToAdmin}
          onTemporaryThemeToggle={handleTemporaryThemeToggle}
          onLogout={handleLogoutWithCleanup}
          API_BASE_URL={API_BASE_URL}
        />

        <HomePageContent
          darkMode={darkMode}
          instanceAdmin={instanceAdmin}
          activeTab={activeTab}
          contentTab={contentTab}
          settingsTab={settingsTab}
          configurationTab={configurationTab}
          containers={containers}
          containersWithUpdates={containersWithUpdates}
          trackedAppsBehind={trackedAppsBehind}
          loading={loading}
          pulling={pulling}
          error={error}
          pullError={pullError}
          pullSuccess={pullSuccess}
          sourceInstances={sourceInstances}
          unusedImages={unusedImages}
          unusedImagesCount={unusedImagesCount}
          trackedApps={trackedApps}
          dismissedTrackedAppNotifications={dismissedTrackedAppNotifications}
          containersBySource={containersBySource}
          loadingInstances={loadingInstances}
          dockerHubDataPulled={dockerHubDataPulled}
          dataFetched={dataFetched}
          lastPullTime={lastPullTime}
          successfullyUpdatedContainersRef={successfullyUpdatedContainersRef}
          selectedSourceInstances={selectedSourceInstances}
          username={username}
          authToken={authToken}
          avatar={avatar}
          recentAvatars={recentAvatars}
          colorScheme={colorScheme}
          batchConfig={batchConfig}
          setActiveTab={setActiveTab}
          setContentTab={setContentTab}
          setSettingsTab={setSettingsTab}
          setConfigurationTab={setConfigurationTab}
          setSelectedSourceInstances={setSelectedSourceInstances}
          setError={setError}
          setContainers={setContainers}
          setUnusedImages={setUnusedImages}
          setUnusedImagesCount={setUnusedImagesCount}
          fetchContainers={fetchContainers}
          fetchUnusedImages={fetchUnusedImages}
          fetchTrackedApps={fetchTrackedApps}
          openModal={openModal}
          handlePull={handlePull}
          handleBatchPull={handleBatchPull}
          handleBatchTrackedAppsCheck={handleBatchTrackedAppsCheck}
          handleUsernameUpdate={handleUsernameUpdate}
          handlePasswordUpdateSuccessWithNavigation={handlePasswordUpdateSuccessWithNavigation}
          handleSourceInstancesChange={handleSourceInstancesChange}
          handleAvatarChange={handleAvatarChange}
          handleRecentAvatarsChange={handleRecentAvatarsChange}
          handleAvatarUploaded={handleAvatarUploaded}
          handleBatchConfigUpdate={handleBatchConfigUpdate}
          handleColorSchemeChange={handleColorSchemeChange}
          onTemporaryThemeToggle={handleTemporaryThemeToggle}
          handleClear={handleClear}
          handleClearGitHubCache={handleClearGitHubCache}
          handleLogoutWithCleanup={handleLogoutWithCleanup}
          editingSourceInstance={editingSourceInstance}
          fetchSourceInstances={fetchSourceInstances}
          containerUpgrade={containerUpgrade}
        />

        <div className="version-footer-wrapper">
          <VersionFooter version={version} isDevBuild={isDevBuild} />
        </div>

        <Suspense fallback={null}>
          <HomePageModals
            showAddSourceModal={showAddSourceModal}
            editingSourceInstance={editingSourceInstance}
            closeModal={closeModal}
            handleModalSuccess={handleModalSuccess}
          />
        </Suspense>
      </div>
    </BatchConfigContext.Provider>
  );
}

HomePage.propTypes = {
  username: PropTypes.string,
  userRole: PropTypes.string,
  avatar: PropTypes.string,
  recentAvatars: PropTypes.array,
  darkMode: PropTypes.bool,
  instanceAdmin: PropTypes.bool,
  authToken: PropTypes.string,
  activeTab: PropTypes.string.isRequired,
  contentTab: PropTypes.string.isRequired,
  settingsTab: PropTypes.string.isRequired,
  configurationTab: PropTypes.string.isRequired,
  selectedSourceInstances: PropTypes.instanceOf(Set).isRequired,
  selectedContainers: PropTypes.instanceOf(Set).isRequired,
  selectedImages: PropTypes.instanceOf(Set).isRequired,
  collapsedStacks: PropTypes.instanceOf(Set).isRequired,
  pulling: PropTypes.bool.isRequired,
  loading: PropTypes.bool.isRequired,
  error: PropTypes.string,
  pullError: PropTypes.string,
  pullSuccess: PropTypes.string,
  containers: PropTypes.array.isRequired,
  stacks: PropTypes.array.isRequired,
  unusedImages: PropTypes.array.isRequired,
  unusedImagesCount: PropTypes.number.isRequired,
  trackedApps: PropTypes.array.isRequired,
  sourceInstances: PropTypes.array.isRequired,
  containersBySource: PropTypes.object.isRequired,
  loadingInstances: PropTypes.instanceOf(Set).isRequired,
  dockerHubDataPulled: PropTypes.bool.isRequired,
  lastPullTime: PropTypes.instanceOf(Date),
  successfullyUpdatedContainersRef: PropTypes.object.isRequired,
  sourceInstancesFromAPI: PropTypes.array.isRequired,
  notificationCount: PropTypes.number.isRequired,
  activeContainersWithUpdates: PropTypes.array.isRequired,
  activeTrackedAppsBehind: PropTypes.array.isRequired,
  versionUpdateInfo: PropTypes.shape({
    hasUpdate: PropTypes.bool,
    latestVersion: PropTypes.string,
    currentVersion: PropTypes.string,
    checkedAt: PropTypes.string,
  }),
  dismissedTrackedAppNotifications: PropTypes.object.isRequired,
  trackedAppsBehind: PropTypes.number.isRequired,
  showAvatarMenu: PropTypes.bool.isRequired,
  showNotificationMenu: PropTypes.bool.isRequired,
  toggleAvatarMenu: PropTypes.func.isRequired,
  toggleNotificationMenu: PropTypes.func.isRequired,
  showAddSourceModal: PropTypes.bool.isRequired,
  editingSourceInstance: PropTypes.object,
  closeModal: PropTypes.func.isRequired,
  setActiveTab: PropTypes.func.isRequired,
  setContentTab: PropTypes.func.isRequired,
  setSettingsTab: PropTypes.func.isRequired,
  setConfigurationTab: PropTypes.func.isRequired,
  setSelectedSourceInstances: PropTypes.func.isRequired,
  setError: PropTypes.func.isRequired,
  handleNavigateToSummary: PropTypes.func.isRequired,
  handleNavigateToSettings: PropTypes.func.isRequired,
  handleNavigateToBatch: PropTypes.func.isRequired,
  handleNavigateToAdmin: PropTypes.func.isRequired,
  handleNavigateToContainers: PropTypes.func.isRequired,
  handleNavigateToTrackedApps: PropTypes.func.isRequired,
  handleDismissContainerNotification: PropTypes.func.isRequired,
  handleDismissTrackedAppNotification: PropTypes.func.isRequired,
  onDismissVersionUpdateNotification: PropTypes.func,
  handleTemporaryThemeToggle: PropTypes.func.isRequired,
  handleLogoutWithCleanup: PropTypes.func.isRequired,
  handleUsernameUpdate: PropTypes.func.isRequired,
  handlePasswordUpdateSuccessWithNavigation: PropTypes.func.isRequired,
  handleSourceInstancesChange: PropTypes.func.isRequired,
  handleAvatarChange: PropTypes.func.isRequired,
  handleRecentAvatarsChange: PropTypes.func.isRequired,
  handleAvatarUploaded: PropTypes.func.isRequired,
  handleBatchConfigUpdate: PropTypes.func.isRequired,
  handleClear: PropTypes.func.isRequired,
  handleClearGitHubCache: PropTypes.func.isRequired,
  handlePull: PropTypes.func.isRequired,
  handleUpgrade: PropTypes.func.isRequired,
  handleBatchUpgrade: PropTypes.func.isRequired,
  handleDeleteImage: PropTypes.func.isRequired,
  handleDeleteImages: PropTypes.func.isRequired,
  handleToggleSelect: PropTypes.func.isRequired,
  handleSelectAll: PropTypes.func.isRequired,
  handleToggleImageSelect: PropTypes.func.isRequired,
  handleSelectAllImages: PropTypes.func.isRequired,
  handleBatchPull: PropTypes.func.isRequired,
  handleBatchTrackedAppsCheck: PropTypes.func.isRequired,
  handleNewInstanceDataFetch: PropTypes.func.isRequired,
  fetchSourceInstances: PropTypes.func.isRequired,
  fetchContainers: PropTypes.func.isRequired,
  fetchUnusedImages: PropTypes.func.isRequired,
  fetchRecentAvatars: PropTypes.func.isRequired,
  fetchAvatar: PropTypes.func.isRequired,
  setContainers: PropTypes.func.isRequired,
  setStacks: PropTypes.func.isRequired,
  setUnusedImages: PropTypes.func.isRequired,
  setUnusedImagesCount: PropTypes.func.isRequired,
  openModal: PropTypes.func.isRequired,
  handleModalSuccess: PropTypes.func.isRequired,
  colorScheme: PropTypes.string.isRequired,
  handleColorSchemeChange: PropTypes.func.isRequired,
  batchConfig: PropTypes.object.isRequired,
  setBatchConfig: PropTypes.func.isRequired,
  version: PropTypes.string.isRequired,
  isDevBuild: PropTypes.bool.isRequired,
  API_BASE_URL: PropTypes.string.isRequired,
  draggedTabIndex: PropTypes.number,
  setDraggedTabIndex: PropTypes.func.isRequired,
  handleReorderTabs: PropTypes.func.isRequired,
  toggleStack: PropTypes.func.isRequired,
  discordWebhooks: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      avatarUrl: PropTypes.string,
      name: PropTypes.string,
      serverName: PropTypes.string,
      enabled: PropTypes.bool,
    })
  ),
  containerUpgrade: PropTypes.object,
};

export default HomePage;

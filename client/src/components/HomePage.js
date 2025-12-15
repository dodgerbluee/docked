import React, { useMemo } from "react";
import PropTypes from "prop-types";
import Header from "./Header/Header";
import VersionFooter from "./Footer/VersionFooter";
import { BatchConfigContext } from "../contexts/BatchConfigContext";
import HomePageContent from "./HomePage/components/HomePageContent";
import HomePageModals from "./HomePage/components/HomePageModals";
import { usePageVisibilitySettings } from "../hooks/usePageVisibilitySettings";
import { TAB_NAMES } from "../constants/apiConstants";
import { computeHasUpdate } from "../utils/containerUpdateHelpers";

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
  selectedPortainerInstances,
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
  portainerInstances,
  containersByPortainer,
  loadingInstances,
  dockerHubDataPulled,
  lastPullTime,
  successfullyUpdatedContainersRef,
  portainerInstancesFromAPI,
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
  showAddPortainerModal,
  editingPortainerInstance,
  closeModal,
  // Handlers
  setActiveTab,
  setContentTab,
  setSettingsTab,
  setConfigurationTab,
  setSelectedPortainerInstances,
  setError,
  handleNavigateToSummary,
  handleNavigateToSettings,
  handleNavigateToBatch,
  handleNavigateToAdmin,
  handleNavigateToPortainer,
  handleNavigateToTrackedApps,
  handleDismissContainerNotification,
  handleDismissTrackedAppNotification,
  onDismissVersionUpdateNotification,
  handleTemporaryThemeToggle,
  handleLogoutWithCleanup,
  handleUsernameUpdate,
  handlePasswordUpdateSuccessWithNavigation,
  handlePortainerInstancesChange,
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
  fetchPortainerInstances,
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
  dockerHubCredentials,
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
}) {
  const { disablePortainerPage, disableTrackedAppsPage, refreshSettings } =
    usePageVisibilitySettings();

  // Listen for settings updates and refresh
  React.useEffect(() => {
    const handleSettingsUpdate = () => {
      refreshSettings();
    };

    window.addEventListener("pageVisibilitySettingsUpdated", handleSettingsUpdate);
    return () => {
      window.removeEventListener("pageVisibilitySettingsUpdated", handleSettingsUpdate);
    };
  }, [refreshSettings]);

  // Redirect to summary if user is on a disabled page
  React.useEffect(() => {
    if (disablePortainerPage && activeTab === TAB_NAMES.PORTAINER) {
      setActiveTab(TAB_NAMES.SUMMARY);
    }
    if (disableTrackedAppsPage && activeTab === TAB_NAMES.TRACKED_APPS) {
      setActiveTab(TAB_NAMES.SUMMARY);
    }
  }, [disablePortainerPage, disableTrackedAppsPage, activeTab, setActiveTab]);
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
          notificationCount={notificationCount}
          activeContainersWithUpdates={activeContainersWithUpdates}
          activeTrackedAppsBehind={activeTrackedAppsBehind}
          versionUpdateInfo={versionUpdateInfo}
          discordWebhooks={discordWebhooks}
          showNotificationMenu={showNotificationMenu}
          showAvatarMenu={showAvatarMenu}
          onToggleNotificationMenu={toggleNotificationMenu}
          onToggleAvatarMenu={toggleAvatarMenu}
          instanceAdmin={instanceAdmin}
          onNavigateToSummary={handleNavigateToSummary}
          onNavigateToSettings={handleNavigateToSettings}
          onNavigateToBatch={handleNavigateToBatch}
          onNavigateToAdmin={handleNavigateToAdmin}
          onNavigateToPortainer={handleNavigateToPortainer}
          onNavigateToTrackedApps={handleNavigateToTrackedApps}
          onDismissContainerNotification={handleDismissContainerNotification}
          onDismissTrackedAppNotification={handleDismissTrackedAppNotification}
          onDismissVersionUpdateNotification={onDismissVersionUpdateNotification}
          onTemporaryThemeToggle={handleTemporaryThemeToggle}
          onLogout={handleLogoutWithCleanup}
          API_BASE_URL={API_BASE_URL}
        />

        <HomePageContent
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
          dockerHubCredentials={dockerHubCredentials}
          portainerInstances={portainerInstances}
          unusedImages={unusedImages}
          unusedImagesCount={unusedImagesCount}
          trackedApps={trackedApps}
          dismissedTrackedAppNotifications={dismissedTrackedAppNotifications}
          containersByPortainer={containersByPortainer}
          loadingInstances={loadingInstances}
          dockerHubDataPulled={dockerHubDataPulled}
          lastPullTime={lastPullTime}
          successfullyUpdatedContainersRef={successfullyUpdatedContainersRef}
          selectedPortainerInstances={selectedPortainerInstances}
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
          setSelectedPortainerInstances={setSelectedPortainerInstances}
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
          handlePortainerInstancesChange={handlePortainerInstancesChange}
          handleAvatarChange={handleAvatarChange}
          handleRecentAvatarsChange={handleRecentAvatarsChange}
          handleAvatarUploaded={handleAvatarUploaded}
          handleBatchConfigUpdate={handleBatchConfigUpdate}
          handleColorSchemeChange={handleColorSchemeChange}
          handleClear={handleClear}
          handleClearGitHubCache={handleClearGitHubCache}
          handleLogoutWithCleanup={handleLogoutWithCleanup}
          editingPortainerInstance={editingPortainerInstance}
          fetchPortainerInstances={fetchPortainerInstances}
          disablePortainerPage={disablePortainerPage}
          disableTrackedAppsPage={disableTrackedAppsPage}
        />

        <div className="version-footer-wrapper">
          <VersionFooter version={version} isDevBuild={isDevBuild} />
        </div>

        <HomePageModals
          showAddPortainerModal={showAddPortainerModal}
          editingPortainerInstance={editingPortainerInstance}
          closeModal={closeModal}
          handleModalSuccess={handleModalSuccess}
        />
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
  selectedPortainerInstances: PropTypes.instanceOf(Set).isRequired,
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
  portainerInstances: PropTypes.array.isRequired,
  containersByPortainer: PropTypes.object.isRequired,
  loadingInstances: PropTypes.instanceOf(Set).isRequired,
  dockerHubDataPulled: PropTypes.bool.isRequired,
  lastPullTime: PropTypes.instanceOf(Date),
  successfullyUpdatedContainersRef: PropTypes.object.isRequired,
  portainerInstancesFromAPI: PropTypes.array.isRequired,
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
  showAddPortainerModal: PropTypes.bool.isRequired,
  editingPortainerInstance: PropTypes.object,
  closeModal: PropTypes.func.isRequired,
  setActiveTab: PropTypes.func.isRequired,
  setContentTab: PropTypes.func.isRequired,
  setSettingsTab: PropTypes.func.isRequired,
  setConfigurationTab: PropTypes.func.isRequired,
  setSelectedPortainerInstances: PropTypes.func.isRequired,
  setError: PropTypes.func.isRequired,
  handleNavigateToSummary: PropTypes.func.isRequired,
  handleNavigateToSettings: PropTypes.func.isRequired,
  handleNavigateToBatch: PropTypes.func.isRequired,
  handleNavigateToAdmin: PropTypes.func.isRequired,
  handleNavigateToPortainer: PropTypes.func.isRequired,
  handleNavigateToTrackedApps: PropTypes.func.isRequired,
  handleDismissContainerNotification: PropTypes.func.isRequired,
  handleDismissTrackedAppNotification: PropTypes.func.isRequired,
  onDismissVersionUpdateNotification: PropTypes.func,
  handleTemporaryThemeToggle: PropTypes.func.isRequired,
  handleLogoutWithCleanup: PropTypes.func.isRequired,
  handleUsernameUpdate: PropTypes.func.isRequired,
  handlePasswordUpdateSuccessWithNavigation: PropTypes.func.isRequired,
  handlePortainerInstancesChange: PropTypes.func.isRequired,
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
  fetchPortainerInstances: PropTypes.func.isRequired,
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
  dockerHubCredentials: PropTypes.object,
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
};

export default HomePage;

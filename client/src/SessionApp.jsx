import React, { lazy, Suspense, useState, useEffect, useRef, useCallback } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
// Formatter utilities are now used in their respective components
const LogsPage = lazy(() => import("./pages/LogsPage"));
import { API_BASE_URL } from "./constants/api";
import { useNotifications } from "./hooks/useNotifications";
import { useContainersData } from "./hooks/useContainersData";
import { useBatchProcessing } from "./hooks/useBatchProcessing";
import { useContainerOperations } from "./hooks/useContainerOperations";
import { useSelectionHandlers } from "./hooks/useSelectionHandlers";
import { useAvatarManagement } from "./hooks/useAvatarManagement";
import { useNavigation } from "./hooks/useNavigation";
import { useTheme } from "./hooks/useTheme";
import { useBatchConfig } from "./hooks/useBatchConfig";
import { useTrackedApps } from "./hooks/useTrackedApps";
import { useSourceInstances } from "./hooks/useSourceInstances";
import { useSidebarHeight } from "./hooks/useSidebarHeight";
import { useVersion } from "./hooks/useVersion";
import { useMenuState } from "./hooks/useMenuState";
import { useTabState } from "./hooks/useTabState";
import { useGitHubCache } from "./hooks/useGitHubCache";
import { useAppInitialization } from "./hooks/useAppInitialization";
import { useDiscordSettings } from "./hooks/useDiscordSettings";
import { useContainerUpgrade } from "./hooks/useContainersPage/hooks/useContainerUpgrade";
import HomePage from "./components/HomePage";
import LoadingSpinner from "./components/ui/LoadingSpinner";
import { TAB_NAMES } from "./constants/apiConstants";

/**
 * The entire session-scoped application tree.
 *
 * App.jsx renders this with key={sessionKey}, where sessionKey is bumped on
 * every login/logout/cross-tab session change. That means the WHOLE subtree is
 * unmounted and rebuilt when the identity changes: avatar, batch config,
 * upgrade progress state, pull/clear state, notification dismissals, tab and
 * selection state — every hook that holds user data — die with the session
 * instead of surviving into the next user's view. Hook-level generation guards
 * protect against late async writes; the remount guarantees no *state* crosses
 * the session boundary even when a guard is forgotten.
 */
function SessionApp({
  authToken,
  username,
  userRole,
  instanceAdmin,
  handleUsernameUpdate,
  handlePasswordUpdateSuccess,
  handleLogoutWithCleanup,
}) {
  // Menu state - using custom hook
  const menuState = useMenuState();
  const {
    showAvatarMenu,
    showNotificationMenu,
    toggleAvatarMenu,
    toggleNotificationMenu,
    setShowAvatarMenu,
    setShowNotificationMenu,
  } = menuState;

  // Tab state - using custom hook
  const tabState = useTabState();
  const {
    activeTab,
    contentTab,
    settingsTab,
    configurationTab,
    setActiveTab,
    setContentTab,
    setSettingsTab,
    setConfigurationTab,
  } = tabState;

  // Selection state
  const [selectedSourceInstances, setSelectedSourceInstances] = useState(new Set());
  const [selectedContainers, setSelectedContainers] = useState(new Set());
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [collapsedStacks, setCollapsedStacks] = useState(new Set());
  const [pulling, setPulling] = useState(false);
  const [pullSuccess, setPullSuccess] = useState(null);
  const [pullError, setPullError] = useState(null);
  const [lastPullTime, setLastPullTime] = useState(() => {
    try {
      const stored = localStorage.getItem("lastPullTime");
      if (stored) {
        return new Date(stored);
      }
    } catch (err) {
      console.error("Error loading lastPullTime:", err);
    }
    return null;
  });

  // Theme management - using custom hook
  const {
    colorScheme,
    darkMode,
    fetchColorScheme,
    handleColorSchemeChange,
    handleTemporaryThemeToggle,
  } = useTheme(true, authToken);

  // Docker Hub credentials removed - crane/skopeo use system Docker credentials

  // Tracked apps - using custom hook
  const { trackedApps, setTrackedApps, fetchTrackedApps } = useTrackedApps(true, authToken);

  // Avatar management - using custom hook
  const avatarManagement = useAvatarManagement(true, authToken);
  const {
    avatar,
    recentAvatars,
    setRecentAvatars,
    fetchAvatar,
    fetchRecentAvatars,
    handleAvatarChange,
  } = avatarManagement;

  // Version - using custom hook
  const { version, isDevBuild } = useVersion();

  // Batch config - using custom hook
  const { batchConfig, setBatchConfig, handleBatchConfigUpdate } = useBatchConfig(true, authToken);

  // Discord webhooks - using custom hook
  const { discordWebhooks } = useDiscordSettings(true, authToken);

  // Container data management - using custom hook
  const successfullyUpdatedContainersRef = useRef(new Set()); // Track containers that were successfully updated to preserve hasUpdate:false
  const containersData = useContainersData(successfullyUpdatedContainersRef);
  const {
    containers,
    stacks,
    runners,
    loading,
    error,
    unusedImages,
    unusedImagesCount,
    loadingInstances,
    dockerHubDataPulled,
    dataFetched,
    setContainers,
    setStacks,
    setError,
    setUnusedImages,
    setUnusedImagesCount,
    setDockerHubDataPulled,
    setDataFetched,
    fetchContainers,
    fetchUnusedImages,
    updateLastImageDeleteTime,
  } = containersData;

  // GitHub cache management - using custom hook (moved after fetchTrackedApps is available)
  const { handleClearGitHubCache } = useGitHubCache(fetchTrackedApps);

  // Batch processing - using custom hook
  const batchProcessing = useBatchProcessing({
    isAuthenticated: true,
    authToken,
    batchConfig,
    containersData,
    successfullyUpdatedContainersRef,
    setPulling,
    setError,
    setLastPullTime,
    fetchTrackedApps,
    fetchContainers,
  });
  const { handleBatchPull, handleBatchTrackedAppsCheck } = batchProcessing;

  // Container operations - using custom hook
  const containerOperations = useContainerOperations({
    unusedImages,
    setContainers,
    setStacks,
    setUnusedImages,
    setUnusedImagesCount,
    setSelectedContainers,
    setSelectedImages,
    setDockerHubDataPulled,
    setDataFetched,
    setError,
    setPulling,
    setPullSuccess,
    setPullError,
    setClearing: () => {}, // Will be set below
    setDeletingImages: () => {}, // Will be set below
    successfullyUpdatedContainersRef,
    fetchContainers,
    fetchUnusedImages,
    updateLastImageDeleteTime,
  });
  const { handleClear, handlePull } = containerOperations;

  // Container upgrade state lifted to SessionApp so completed upgrade cards persist 10 min when switching tabs
  const containerUpgrade = useContainerUpgrade({
    successfullyUpdatedContainersRef,
    onContainersUpdate: setContainers,
    fetchContainers,
  });

  // Selection handlers - using custom hook
  const selectionHandlers = useSelectionHandlers({
    selectedContainers,
    setSelectedContainers,
    selectedImages,
    setSelectedImages,
    unusedImages,
  });
  const { handleToggleSelect, handleSelectAll, handleToggleImageSelect, handleSelectAllImages } =
    selectionHandlers;

  // Navigation handlers - using custom hook
  const navigation = useNavigation({
    setActiveTab,
    setContentTab,
    setSelectedSourceInstances,
  });
  const {
    handleNavigateToSummary,
    handleNavigateToContainers,
    handleNavigateToTrackedApps,
    handleNavigateToSettings,
    handleNavigateToBatch,
  } = navigation;

  const handleNavigateToAdmin = useCallback(() => {
    setActiveTab(TAB_NAMES.ADMIN);
  }, [setActiveTab]);

  // App initialization - using custom hook
  useAppInitialization({
    isAuthenticated: true,
    authToken,
    fetchColorScheme,
    fetchContainers,
    fetchAvatar,
    fetchRecentAvatars,
    fetchTrackedApps,
    setDataFetched,
    setDockerHubDataPulled,
    setContainers,
    setStacks,
    setUnusedImages,
    setUnusedImagesCount,
    setTrackedApps,
    showAvatarMenu,
    showNotificationMenu,
    setShowAvatarMenu,
    setShowNotificationMenu,
  });

  // Notification management - using custom hook
  const {
    activeContainersWithUpdates,
    activeTrackedAppsBehind,
    versionUpdateInfo,
    notificationCount,
    trackedAppsStats,
    dismissedTrackedAppNotifications,
    handleDismissContainerNotification,
    handleDismissTrackedAppNotification,
    handleDismissVersionUpdateNotification,
  } = useNotifications(containers, trackedApps, instanceAdmin);

  const { trackedAppsBehind } = trackedAppsStats;

  // Source instances management - using custom hook
  const { sourceInstances, containersBySource } = useSourceInstances({ containers, runners });

  // Safety check: If activeTab is a source instance name but that instance doesn't exist,
  // switch back to summary to avoid broken state
  useEffect(() => {
    const validTabs = [
      TAB_NAMES.SUMMARY,
      TAB_NAMES.CONTAINERS,
      TAB_NAMES.APPS,
      TAB_NAMES.TRACKED_APPS,
      TAB_NAMES.INTENTS,
      TAB_NAMES.ANALYTICS,
      TAB_NAMES.SETTINGS,
      TAB_NAMES.CONFIGURATION,
      TAB_NAMES.BATCH_LOGS,
      TAB_NAMES.ADMIN,
    ];

    if (
      !validTabs.includes(activeTab) &&
      sourceInstances.length > 0 &&
      !sourceInstances.find((inst) => inst.name === activeTab)
    ) {
      console.warn(`Active tab "${activeTab}" no longer exists, switching to summary`);
      setActiveTab(TAB_NAMES.SUMMARY);
    }
  }, [activeTab, sourceInstances, setActiveTab]);

  // Initialize selectedSourceInstances to empty (show all) when Containers tab is first opened
  // Empty set means show all instances
  useEffect(() => {
    if (
      activeTab === TAB_NAMES.CONTAINERS &&
      selectedSourceInstances.size === 0 &&
      sourceInstances.length > 0 &&
      !sourceInstances.some((inst) => selectedSourceInstances.has(inst.name))
    ) {
      // Start with empty set - show all by default
      // No need to set anything, empty set is the default
    }
  }, [activeTab, sourceInstances, selectedSourceInstances]);

  // Match sidebar height to stacks container height - using custom hook
  useSidebarHeight(activeTab);

  const toggleStack = (stackKey) => {
    setCollapsedStacks((prev) => {
      const next = new Set(prev);
      if (next.has(stackKey)) {
        next.delete(stackKey);
      } else {
        next.add(stackKey);
      }
      return next;
    });
  };

  // Use React Router for routing
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route
          path="/logs"
          element={
            <LogsPage
              headerProps={{
                username,
                userRole,
                avatar,
                darkMode,
                showAvatarMenu,
                onToggleAvatarMenu: toggleAvatarMenu,
                onTemporaryThemeToggle: handleTemporaryThemeToggle,
                onLogout: handleLogoutWithCleanup,
              }}
              settingsProps={{
                username,
                avatar,
                recentAvatars,
                onUsernameUpdate: handleUsernameUpdate,
                onLogout: handleLogoutWithCleanup,
                onPasswordUpdateSuccess: handlePasswordUpdateSuccess,
                onAvatarChange: handleAvatarChange,
                onRecentAvatarsChange: (avatars) => {
                  setRecentAvatars(avatars);
                  fetchRecentAvatars();
                },
                onAvatarUploaded: async () => {
                  await fetchAvatar();
                },
                onBatchConfigUpdate: handleBatchConfigUpdate,
                colorScheme,
                onColorSchemeChange: handleColorSchemeChange,
                onClearSourceData: handleClear,
                onClearTrackedAppData: handleClearGitHubCache,
              }}
              onNavigateToSummary={handleNavigateToSummary}
              onNavigateToSettings={handleNavigateToSettings}
              onNavigateToBatch={handleNavigateToBatch}
              onNavigateToContainers={handleNavigateToContainers}
              onNavigateToTrackedApps={handleNavigateToTrackedApps}
              onSetSettingsTab={setSettingsTab}
              API_BASE_URL={API_BASE_URL}
            />
          }
        />
        <Route
          path="/"
          element={
            <HomePage
              username={username}
              userRole={userRole}
              avatar={avatar}
              darkMode={darkMode}
              instanceAdmin={instanceAdmin}
              authToken={authToken}
              activeTab={activeTab}
              contentTab={contentTab}
              settingsTab={settingsTab}
              configurationTab={configurationTab}
              selectedSourceInstances={selectedSourceInstances}
              selectedContainers={selectedContainers}
              selectedImages={selectedImages}
              collapsedStacks={collapsedStacks}
              pulling={pulling}
              loading={loading}
              error={error}
              pullError={pullError}
              pullSuccess={pullSuccess}
              containers={containers}
              stacks={stacks}
              unusedImages={unusedImages}
              unusedImagesCount={unusedImagesCount}
              trackedApps={trackedApps}
              sourceInstances={sourceInstances || []}
              containersBySource={containersBySource}
              loadingInstances={loadingInstances}
              dockerHubDataPulled={dockerHubDataPulled}
              dataFetched={dataFetched}
              lastPullTime={lastPullTime}
              successfullyUpdatedContainersRef={successfullyUpdatedContainersRef}
              notificationCount={notificationCount}
              activeContainersWithUpdates={activeContainersWithUpdates}
              activeTrackedAppsBehind={activeTrackedAppsBehind}
              versionUpdateInfo={versionUpdateInfo}
              dismissedTrackedAppNotifications={dismissedTrackedAppNotifications}
              trackedAppsBehind={trackedAppsBehind}
              showAvatarMenu={showAvatarMenu}
              showNotificationMenu={showNotificationMenu}
              toggleAvatarMenu={toggleAvatarMenu}
              toggleNotificationMenu={toggleNotificationMenu}
              setActiveTab={setActiveTab}
              setContentTab={setContentTab}
              setSettingsTab={setSettingsTab}
              setConfigurationTab={setConfigurationTab}
              setSelectedSourceInstances={setSelectedSourceInstances}
              setError={setError}
              handleNavigateToSummary={handleNavigateToSummary}
              handleNavigateToSettings={handleNavigateToSettings}
              handleNavigateToBatch={handleNavigateToBatch}
              handleNavigateToAdmin={handleNavigateToAdmin}
              handleNavigateToContainers={handleNavigateToContainers}
              handleNavigateToTrackedApps={handleNavigateToTrackedApps}
              handleDismissContainerNotification={handleDismissContainerNotification}
              handleDismissTrackedAppNotification={handleDismissTrackedAppNotification}
              onDismissVersionUpdateNotification={handleDismissVersionUpdateNotification}
              handleTemporaryThemeToggle={handleTemporaryThemeToggle}
              handleLogoutWithCleanup={handleLogoutWithCleanup}
              handleUsernameUpdate={handleUsernameUpdate}
              handlePasswordUpdateSuccessWithNavigation={handlePasswordUpdateSuccess}
              handleAvatarChange={handleAvatarChange}
              handleRecentAvatarsChange={(avatars) => {
                setRecentAvatars(avatars);
                fetchRecentAvatars();
              }}
              handleAvatarUploaded={async () => {
                await fetchAvatar();
              }}
              handleBatchConfigUpdate={handleBatchConfigUpdate}
              handleClear={handleClear}
              handleClearGitHubCache={handleClearGitHubCache}
              handlePull={handlePull}
              handleToggleSelect={handleToggleSelect}
              handleSelectAll={handleSelectAll}
              handleToggleImageSelect={handleToggleImageSelect}
              handleSelectAllImages={handleSelectAllImages}
              handleBatchPull={handleBatchPull}
              handleBatchTrackedAppsCheck={handleBatchTrackedAppsCheck}
              fetchContainers={fetchContainers}
              fetchUnusedImages={fetchUnusedImages}
              fetchRecentAvatars={fetchRecentAvatars}
              fetchAvatar={fetchAvatar}
              fetchTrackedApps={fetchTrackedApps}
              setContainers={setContainers}
              setStacks={setStacks}
              setUnusedImages={setUnusedImages}
              setUnusedImagesCount={setUnusedImagesCount}
              colorScheme={colorScheme}
              handleColorSchemeChange={handleColorSchemeChange}
              batchConfig={batchConfig}
              setBatchConfig={setBatchConfig}
              version={version}
              isDevBuild={isDevBuild}
              API_BASE_URL={API_BASE_URL}
              toggleStack={toggleStack}
              discordWebhooks={discordWebhooks}
              containerUpgrade={containerUpgrade}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default SessionApp;

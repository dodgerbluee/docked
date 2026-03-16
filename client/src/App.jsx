import React, { lazy, Suspense, useState, useEffect, useRef, useCallback } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import "./App.css";
import "./styles/responsive.css";
import { initializePerformanceMonitoring, MobilePerformance } from "./utils/performance";

// PWA Service Worker Registration
const registerServiceWorker = () => {
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          console.log("SW registered: ", registration);
        })
        .catch((registrationError) => {
          console.log("SW registration failed: ", registrationError);
        });
    });
  }
};
import Login from "./components/Login";
import OAuthCallback from "./components/OAuthCallback";
import LoadingSpinner from "./components/ui/LoadingSpinner";
// Formatter utilities are now used in their respective components
const LogsPage = lazy(() => import("./pages/LogsPage"));
// buildContainersBySource is now imported in useSourceInstances hook
import { API_BASE_URL } from "./constants/api";
import { useAuth } from "./hooks/useAuth";
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
import { useNewSourceInstance } from "./hooks/useNewSourceInstance";
import { useVersion } from "./hooks/useVersion";
import { useModalState } from "./hooks/useModalState";
import { useMenuState } from "./hooks/useMenuState";
import { useTabState } from "./hooks/useTabState";
import { useGitHubCache } from "./hooks/useGitHubCache";
import { useTabReordering } from "./hooks/useTabReordering";
import { useEnhancedNavigation } from "./hooks/useEnhancedNavigation";
import { useAppInitialization } from "./hooks/useAppInitialization";
import { useAddSourceModal } from "./hooks/useAddSourceModal";
import { useDiscordSettings } from "./hooks/useDiscordSettings";
import { useContainerUpgrade } from "./hooks/useContainersPage/hooks/useContainerUpgrade";
import HomePage from "./components/HomePage";
import { TAB_NAMES } from "./constants/apiConstants";

function App() {
  // Authentication state - using custom hook
  const {
    isAuthenticated,
    authToken,
    username,
    userRole,
    instanceAdmin,
    isValidating,
    handleLogin,
    handleUsernameUpdate,
    handlePasswordUpdateSuccess,
    handleLogout,
  } = useAuth();
  // Modal state - using custom hook
  const modalState = useModalState();
  const { showAddSourceModal, editingSourceInstance, openModal, closeModal } = modalState;

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
  } = useTheme(isAuthenticated, authToken);

  // Docker Hub credentials removed - crane/skopeo use system Docker credentials

  // Tracked apps - using custom hook
  const { trackedApps, setTrackedApps, fetchTrackedApps } = useTrackedApps(
    isAuthenticated,
    authToken
  );
  // Avatar management - using custom hook
  const avatarManagement = useAvatarManagement(isAuthenticated, authToken);
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
  const { batchConfig, setBatchConfig, handleBatchConfigUpdate } = useBatchConfig(
    isAuthenticated,
    authToken
  );

  // Discord webhooks - using custom hook
  const { discordWebhooks } = useDiscordSettings(isAuthenticated, authToken);

  // Initialize performance monitoring and PWA
  useEffect(() => {
    // Performance monitoring
    initializePerformanceMonitoring();

    // Mobile optimizations
    if (MobilePerformance.isLowEndDevice()) {
      console.log("Low-end device detected, enabling performance optimizations");
      // Could disable animations, reduce polling frequency, etc.
    }

    // Service worker
    registerServiceWorker();

    // Cleanup on unmount
    return () => {
      if (window.performanceMonitor) {
        window.performanceMonitor.cleanup();
      }
    };
  }, []);

  // Container data management - using custom hook
  const successfullyUpdatedContainersRef = useRef(new Set()); // Track containers that were successfully updated to preserve hasUpdate:false
  const containersData = useContainersData(
    isAuthenticated,
    authToken,
    successfullyUpdatedContainersRef
  );
  const {
    containers,
    stacks,
    loading,
    error,
    unusedImages,
    unusedImagesCount,
    sourceInstancesFromAPI,
    sourceInstancesLoading,
    loadingInstances,
    dockerHubDataPulled,
    dataFetched,
    setContainers,
    setStacks,
    setError,
    setLoading,
    setUnusedImages,
    setUnusedImagesCount,
    setSourceInstancesFromAPI,
    setDockerHubDataPulled,
    setDataFetched,
    fetchContainers,
    fetchUnusedImages,
    fetchSourceInstances,
    updateLastImageDeleteTime,
  } = containersData;

  // GitHub cache management - using custom hook (moved after fetchTrackedApps is available)
  const { handleClearGitHubCache } = useGitHubCache(fetchTrackedApps);

  // Tab reordering - using custom hook (moved after fetchContainers is available)
  const { draggedTabIndex, setDraggedTabIndex, handleReorderTabs } =
    useTabReordering(fetchContainers);

  // Batch processing - using custom hook
  const batchProcessing = useBatchProcessing({
    isAuthenticated,
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

  // New source instance handler - using custom hook
  const { handleNewInstanceDataFetch } = useNewSourceInstance({
    setSourceInstancesFromAPI,
    setContainers,
    setStacks,
    setUnusedImagesCount,
    setDockerHubDataPulled,
    setLoading,
    setActiveTab,
    setContentTab,
    fetchContainers,
    fetchUnusedImages,
    successfullyUpdatedContainersRef,
  });

  // Container operations - using custom hook
  const containerOperations = useContainerOperations({
    containers,
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
  const {
    handleUpgrade,
    handleBatchUpgrade,
    handleDeleteImage,
    handleDeleteImages,
    handleClear,
    handlePull,
  } = containerOperations;

  // Container upgrade state lifted to App so completed upgrade cards persist 10 min when switching tabs
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

  // Enhanced navigation handlers - using custom hook
  const enhancedNavigation = useEnhancedNavigation({
    handleLogin,
    handlePasswordUpdateSuccess,
    handleLogout,
    setActiveTab,
    setSettingsTab,
    setError,
    setPullError,
  });
  const {
    handleLoginWithNavigation,
    handlePasswordUpdateSuccessWithNavigation,
    handleLogoutWithCleanup,
  } = enhancedNavigation;

  // Clear error states when authentication state changes (user logs out/in)
  useEffect(() => {
    if (!isAuthenticated) {
      setError(null);
      setPullError(null);
      setPullSuccess(null);
    }
  }, [isAuthenticated, setError, setPullError]);

  // App initialization - using custom hook
  useAppInitialization({
    isAuthenticated,
    authToken,
    fetchColorScheme,
    fetchContainers,
    fetchSourceInstances,
    fetchAvatar,
    fetchRecentAvatars,
    fetchTrackedApps,
    setDataFetched,
    setDockerHubDataPulled,
    setSourceInstancesFromAPI,
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

  // handleToggleImageSelect and handleSelectAllImages are now provided by useSelectionHandlers hook

  // handleDeleteImage is now provided by useContainerOperations hook

  // handleDeleteImages is now provided by useContainerOperations hook

  // formatBytes is now imported from utils/formatters

  // handleUpgrade is now provided by useContainerOperations hook

  // Removed duplicate handleToggleSelect, handleSelectAll, handleToggleStackSelect
  // These are now provided by useSelectionHandlers hook

  // handleBatchUpgrade is now provided by useContainerOperations hook

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
  const { sourceInstances, containersBySource } = useSourceInstances({
    sourceInstancesFromAPI,
    containers,
  });

  // Safety check: If activeTab is a source instance name but that instance doesn't exist,
  // and we're not currently loading instances, switch back to summary to avoid broken state
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
      !sourceInstancesLoading && // Don't switch during loading
      sourceInstancesFromAPI && // Only check if we have instances loaded
      sourceInstancesFromAPI.length > 0 &&
      !sourceInstances.find((inst) => inst.name === activeTab) &&
      !sourceInstancesFromAPI.find((inst) => inst.name === activeTab)
    ) {
      console.warn(`Active tab "${activeTab}" no longer exists, switching to summary`);
      setActiveTab(TAB_NAMES.SUMMARY);
    }
  }, [
    activeTab,
    sourceInstances,
    sourceInstancesFromAPI,
    sourceInstancesLoading,
    setActiveTab,
  ]);

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

  // AddSourceModal success handler - using custom hook
  const { handleModalSuccess } = useAddSourceModal({
    fetchSourceInstances,
    fetchContainers,
    handleNewInstanceDataFetch,
    setSourceInstancesFromAPI,
    setActiveTab,
    setContentTab,
    setSelectedSourceInstances,
    setSettingsTab,
    editingSourceInstance,
    activeTab,
    settingsTab,
    closeModal,
  });

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

  // Show login page if not authenticated
  // Show loading spinner while validating token
  if (isValidating) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          width: "100vw",
        }}
      >
        <LoadingSpinner size="md" message="Validating session..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    // OAuth callback must be accessible while unauthenticated
    // (user is in the middle of the SSO login flow)
    return (
      <Routes>
        <Route
          path="/auth/oauth/complete"
          element={<OAuthCallback onLogin={handleLoginWithNavigation} />}
        />
        <Route path="*" element={<Login onLogin={handleLoginWithNavigation} />} />
      </Routes>
    );
  }

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
                onPasswordUpdateSuccess: handlePasswordUpdateSuccessWithNavigation,
                onSourceInstancesChange: async () => {
                  await fetchSourceInstances();
                  await fetchContainers(false);
                },
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
                onEditInstance: openModal,
                editingSourceInstance,
                refreshInstances:
                  editingSourceInstance === null ? fetchSourceInstances : null,
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
              sourceInstancesFromAPI={sourceInstancesFromAPI}
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
              showAddSourceModal={showAddSourceModal}
              editingSourceInstance={editingSourceInstance}
              closeModal={closeModal}
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
              handlePasswordUpdateSuccessWithNavigation={handlePasswordUpdateSuccessWithNavigation}
              handleSourceInstancesChange={async () => {
                await fetchSourceInstances();
                await fetchContainers(false);
              }}
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
              handleUpgrade={handleUpgrade}
              handleBatchUpgrade={handleBatchUpgrade}
              handleDeleteImage={handleDeleteImage}
              handleDeleteImages={handleDeleteImages}
              handleToggleSelect={handleToggleSelect}
              handleSelectAll={handleSelectAll}
              handleToggleImageSelect={handleToggleImageSelect}
              handleSelectAllImages={handleSelectAllImages}
              handleBatchPull={handleBatchPull}
              handleBatchTrackedAppsCheck={handleBatchTrackedAppsCheck}
              handleNewInstanceDataFetch={handleNewInstanceDataFetch}
              fetchSourceInstances={fetchSourceInstances}
              fetchContainers={fetchContainers}
              fetchUnusedImages={fetchUnusedImages}
              fetchRecentAvatars={fetchRecentAvatars}
              fetchAvatar={fetchAvatar}
              fetchTrackedApps={fetchTrackedApps}
              setContainers={setContainers}
              setStacks={setStacks}
              setUnusedImages={setUnusedImages}
              setUnusedImagesCount={setUnusedImagesCount}
              openModal={openModal}
              handleModalSuccess={handleModalSuccess}
              colorScheme={colorScheme}
              handleColorSchemeChange={handleColorSchemeChange}
              batchConfig={batchConfig}
              setBatchConfig={setBatchConfig}
              version={version}
              isDevBuild={isDevBuild}
              API_BASE_URL={API_BASE_URL}
              draggedTabIndex={draggedTabIndex}
              setDraggedTabIndex={setDraggedTabIndex}
              handleReorderTabs={handleReorderTabs}
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

// Export the context for use in other components
// BatchConfigContext is exported from contexts/BatchConfigContext.js

export default App;

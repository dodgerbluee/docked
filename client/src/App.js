import React, { useState, useEffect, useRef, useCallback } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import "./App.css";
import Login from "./components/Login";
import LoadingSpinner from "./components/ui/LoadingSpinner";
// Formatter utilities are now used in their respective components
import LogsPage from "./pages/LogsPage";
// buildContainersByPortainer is now imported in usePortainerInstances hook
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
import { usePortainerInstances } from "./hooks/usePortainerInstances";
import { useSidebarHeight } from "./hooks/useSidebarHeight";
import { useNewPortainerInstance } from "./hooks/useNewPortainerInstance";
import { useVersion } from "./hooks/useVersion";
import { useModalState } from "./hooks/useModalState";
import { useMenuState } from "./hooks/useMenuState";
import { useTabState } from "./hooks/useTabState";
import { useGitHubCache } from "./hooks/useGitHubCache";
import { useTabReordering } from "./hooks/useTabReordering";
import { useEnhancedNavigation } from "./hooks/useEnhancedNavigation";
import { useAppInitialization } from "./hooks/useAppInitialization";
import { useAddPortainerModal } from "./hooks/useAddPortainerModal";
import { useDiscordSettings } from "./hooks/useDiscordSettings";
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
  const { showAddPortainerModal, editingPortainerInstance, openModal, closeModal } = modalState;

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
  const [selectedPortainerInstances, setSelectedPortainerInstances] = useState(new Set());
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
    portainerInstancesFromAPI,
    portainerInstancesLoading,
    loadingInstances,
    dockerHubDataPulled,
    setContainers,
    setStacks,
    setError,
    setLoading,
    setUnusedImages,
    setUnusedImagesCount,
    setPortainerInstancesFromAPI,
    setDockerHubDataPulled,
    setDataFetched,
    fetchContainers,
    fetchUnusedImages,
    fetchPortainerInstances,
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
  const {
    handleBatchPull,
    handleBatchTrackedAppsCheck,
    batchIntervalRef,
    batchInitialTimeoutRef,
    hasRunInitialPullRef,
  } = batchProcessing;

  // New Portainer instance handler - using custom hook
  const { handleNewInstanceDataFetch } = useNewPortainerInstance({
    setPortainerInstancesFromAPI,
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
    setSelectedPortainerInstances,
  });
  const {
    handleNavigateToSummary,
    handleNavigateToPortainer,
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
    batchIntervalRef,
    batchInitialTimeoutRef,
    hasRunInitialPullRef,
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
    fetchPortainerInstances,
    fetchAvatar,
    fetchRecentAvatars,
    fetchTrackedApps,
    setDataFetched,
    setDockerHubDataPulled,
    setPortainerInstancesFromAPI,
    setContainers,
    setStacks,
    setUnusedImages,
    setUnusedImagesCount,
    setTrackedApps,
    batchIntervalRef,
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

  // Portainer instances management - using custom hook
  const { portainerInstances, containersByPortainer } = usePortainerInstances({
    portainerInstancesFromAPI,
    containers,
  });

  // Safety check: If activeTab is a Portainer instance name but that instance doesn't exist,
  // and we're not currently loading instances, switch back to summary to avoid broken state
  useEffect(() => {
    const validTabs = [
      TAB_NAMES.SUMMARY,
      TAB_NAMES.TRACKED_APPS,
      TAB_NAMES.PORTAINER,
      TAB_NAMES.SETTINGS,
      TAB_NAMES.CONFIGURATION,
      TAB_NAMES.BATCH_LOGS,
      TAB_NAMES.ADMIN,
    ];

    if (
      !validTabs.includes(activeTab) &&
      !portainerInstancesLoading && // Don't switch during loading
      portainerInstancesFromAPI && // Only check if we have instances loaded
      portainerInstancesFromAPI.length > 0 &&
      !portainerInstances.find((inst) => inst.name === activeTab) &&
      !portainerInstancesFromAPI.find((inst) => inst.name === activeTab)
    ) {
      console.warn(`Active tab "${activeTab}" no longer exists, switching to summary`);
      setActiveTab(TAB_NAMES.SUMMARY);
    }
  }, [
    activeTab,
    portainerInstances,
    portainerInstancesFromAPI,
    portainerInstancesLoading,
    setActiveTab,
  ]);

  // Initialize selectedPortainerInstances to empty (show all) when Portainer tab is first opened
  // Empty set means show all instances
  useEffect(() => {
    if (
      activeTab === TAB_NAMES.PORTAINER &&
      selectedPortainerInstances.size === 0 &&
      portainerInstances.length > 0 &&
      !portainerInstances.some((inst) => selectedPortainerInstances.has(inst.name))
    ) {
      // Start with empty set - show all by default
      // No need to set anything, empty set is the default
    }
  }, [activeTab, portainerInstances, selectedPortainerInstances]);

  // Match sidebar height to stacks container height - using custom hook
  useSidebarHeight(activeTab);

  // AddPortainerModal success handler - using custom hook
  const { handleModalSuccess } = useAddPortainerModal({
    fetchPortainerInstances,
    fetchContainers,
    handleNewInstanceDataFetch,
    setPortainerInstancesFromAPI,
    setActiveTab,
    setContentTab,
    setSelectedPortainerInstances,
    setSettingsTab,
    editingPortainerInstance,
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
    return <Login onLogin={handleLoginWithNavigation} />;
  }

  // Use React Router for routing
  return (
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
              notificationCount,
              activeContainersWithUpdates,
              activeTrackedAppsBehind,
              versionUpdateInfo,
              showNotificationMenu,
              showAvatarMenu,
              onToggleNotificationMenu: toggleNotificationMenu,
              onToggleAvatarMenu: toggleAvatarMenu,
              onDismissContainerNotification: handleDismissContainerNotification,
              onDismissTrackedAppNotification: handleDismissTrackedAppNotification,
              onDismissVersionUpdateNotification: handleDismissVersionUpdateNotification,
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
              onPortainerInstancesChange: async () => {
                await fetchPortainerInstances();
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
              onClearPortainerData: handleClear,
              onClearTrackedAppData: handleClearGitHubCache,
              onEditInstance: openModal,
              editingPortainerInstance,
              refreshInstances: editingPortainerInstance === null ? fetchPortainerInstances : null,
            }}
            onNavigateToSummary={handleNavigateToSummary}
            onNavigateToSettings={handleNavigateToSettings}
            onNavigateToBatch={handleNavigateToBatch}
            onNavigateToPortainer={handleNavigateToPortainer}
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
            selectedPortainerInstances={selectedPortainerInstances}
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
            portainerInstances={portainerInstances}
            containersByPortainer={containersByPortainer}
            loadingInstances={loadingInstances}
            dockerHubDataPulled={dockerHubDataPulled}
            lastPullTime={lastPullTime}
            successfullyUpdatedContainersRef={successfullyUpdatedContainersRef}
            portainerInstancesFromAPI={portainerInstancesFromAPI}
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
            showAddPortainerModal={showAddPortainerModal}
            editingPortainerInstance={editingPortainerInstance}
            closeModal={closeModal}
            setActiveTab={setActiveTab}
            setContentTab={setContentTab}
            setSettingsTab={setSettingsTab}
            setConfigurationTab={setConfigurationTab}
            setSelectedPortainerInstances={setSelectedPortainerInstances}
            setError={setError}
            handleNavigateToSummary={handleNavigateToSummary}
            handleNavigateToSettings={handleNavigateToSettings}
            handleNavigateToBatch={handleNavigateToBatch}
            handleNavigateToAdmin={handleNavigateToAdmin}
            handleNavigateToPortainer={handleNavigateToPortainer}
            handleNavigateToTrackedApps={handleNavigateToTrackedApps}
            handleDismissContainerNotification={handleDismissContainerNotification}
            handleDismissTrackedAppNotification={handleDismissTrackedAppNotification}
            onDismissVersionUpdateNotification={handleDismissVersionUpdateNotification}
            handleTemporaryThemeToggle={handleTemporaryThemeToggle}
            handleLogoutWithCleanup={handleLogoutWithCleanup}
            handleUsernameUpdate={handleUsernameUpdate}
            handlePasswordUpdateSuccessWithNavigation={handlePasswordUpdateSuccessWithNavigation}
            handlePortainerInstancesChange={async () => {
              await fetchPortainerInstances();
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
            fetchPortainerInstances={fetchPortainerInstances}
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
          />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Export the context for use in other components
// BatchConfigContext is exported from contexts/BatchConfigContext.js

export default App;

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import axios from "axios";
import "./App.css";
import Login from "./components/Login";
import ErrorBoundary from "./components/ErrorBoundary";
import LoadingSpinner from "./components/ui/LoadingSpinner";
// Formatter utilities are now used in their respective components
import Settings from "./components/Settings";
import AddPortainerModal from "./components/AddPortainerModal";
import BatchLogs from "./components/BatchLogs";
import TrackedAppsPage from "./pages/TrackedAppsPage";
import SummaryPage from "./pages/SummaryPage";
import SettingsPage from "./pages/SettingsPage";
import BatchPage from "./pages/BatchPage";
import PortainerPage from "./pages/PortainerPage";
import LogsPage from "./pages/LogsPage";
import Header from "./components/Header/Header";
import TabNavigation from "./components/TabNavigation/TabNavigation";
import RateLimitError from "./components/ErrorDisplay/RateLimitError";
// buildContainersByPortainer is now imported in usePortainerInstances hook
import { API_BASE_URL } from "./constants/api";
import { BatchConfigContext } from "./contexts/BatchConfigContext";
import { useAuth } from "./hooks/useAuth";
import { useNotifications } from "./hooks/useNotifications";
import { useContainersData } from "./hooks/useContainersData";
import { useBatchProcessing } from "./hooks/useBatchProcessing";
import { useContainerOperations } from "./hooks/useContainerOperations";
import { useSelectionHandlers } from "./hooks/useSelectionHandlers";
import { useAvatarManagement } from "./hooks/useAvatarManagement";
import { useNavigation } from "./hooks/useNavigation";
import { useTheme } from "./hooks/useTheme";
import { useDockerHubCredentials } from "./hooks/useDockerHubCredentials";
import { useBatchConfig } from "./hooks/useBatchConfig";
import { useTrackedImages } from "./hooks/useTrackedImages";
import { usePortainerInstances } from "./hooks/usePortainerInstances";
import { useSidebarHeight } from "./hooks/useSidebarHeight";
import { useNewPortainerInstance } from "./hooks/useNewPortainerInstance";
import { useVersion } from "./hooks/useVersion";
import VersionFooter from "./components/Footer/VersionFooter";
import {
  TAB_NAMES,
  CONTENT_TABS,
  SETTINGS_TABS,
  CONFIGURATION_TABS,
} from "./constants/apiConstants";

function App() {
  // Authentication state - using custom hook
  const {
    isAuthenticated,
    authToken,
    username,
    userRole,
    passwordChanged,
    isValidating,
    handleLogin,
    handleUsernameUpdate,
    handlePasswordUpdateSuccess,
    handleLogout,
  } = useAuth();
  const [showAddPortainerModal, setShowAddPortainerModal] = useState(false);
  const [editingPortainerInstance, setEditingPortainerInstance] = useState(null);
  const [draggedTabIndex, setDraggedTabIndex] = useState(null);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const [showNotificationMenu, setShowNotificationMenu] = useState(false);
  const [settingsTab, setSettingsTab] = useState(SETTINGS_TABS.GENERAL);
  const [configurationTab, setConfigurationTab] = useState(CONFIGURATION_TABS.HISTORY);
  // portainerSubTab removed - deprecated and unused
  const [selectedPortainerInstances, setSelectedPortainerInstances] = useState(new Set()); // Filter for Portainer instances

  const [pullSuccess, setPullSuccess] = useState(null);
  const [pullError, setPullError] = useState(null);
  const [selectedContainers, setSelectedContainers] = useState(new Set());
  const [activeTab, setActiveTab] = useState(TAB_NAMES.SUMMARY);
  const [contentTab, setContentTab] = useState(CONTENT_TABS.UPDATES);
  const [collapsedStacks, setCollapsedStacks] = useState(new Set());
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [pulling, setPulling] = useState(false);
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
  const [clearingGitHubCache, setClearingGitHubCache] = useState(false);

  // Theme management - using custom hook
  const {
    colorScheme,
    darkMode,
    fetchColorScheme,
    handleColorSchemeChange,
    handleTemporaryThemeToggle,
  } = useTheme(isAuthenticated, authToken);

  // Docker Hub credentials - using custom hook
  const { dockerHubCredentials, setDockerHubCredentials, fetchDockerHubCredentials } =
    useDockerHubCredentials(isAuthenticated, authToken);

  // Tracked images - using custom hook
  const { trackedImages, fetchTrackedImages } = useTrackedImages();
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
    authToken,
    passwordChanged
  );

  // Memoize context value to ensure React detects changes
  // MUST be called before any early returns (React Hooks rule)
  // Include setBatchConfig in dependencies as it's part of the context value
  const batchConfigContextValue = useMemo(
    () => ({
      batchConfig,
      setBatchConfig,
    }),
    [batchConfig, setBatchConfig]
  );

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
    dataFetched,
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

  // Batch processing - using custom hook
  const batchProcessing = useBatchProcessing({
    isAuthenticated,
    authToken,
    passwordChanged,
    batchConfig,
    containersData,
    successfullyUpdatedContainersRef,
    setPulling,
    setError,
    setLastPullTime,
    fetchDockerHubCredentials,
    dockerHubCredentials,
    fetchTrackedImages,
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
    upgrading,
    batchUpgrading,
    handleUpgrade,
    handleBatchUpgrade,
    handleDeleteImage,
    handleDeleteImages,
    handleClear,
    handlePull,
    deletingImages,
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

  // handleBatchConfigUpdate is now provided by useBatchConfig hook

  // Enhanced handleLogin to include tab navigation
  const handleLoginWithNavigation = useCallback(
    (token, user, pwdChanged, role) => {
      handleLogin(token, user, pwdChanged, role);
      // If password not changed, show settings immediately with password section
      if (!pwdChanged) {
        setActiveTab(TAB_NAMES.SETTINGS);
        setSettingsTab(SETTINGS_TABS.PASSWORD);
      }
    },
    [handleLogin]
  );

  // Enhanced handlePasswordUpdateSuccess to include tab navigation
  const handlePasswordUpdateSuccessWithNavigation = useCallback(() => {
    handlePasswordUpdateSuccess();
    setActiveTab(TAB_NAMES.SUMMARY);
  }, [handlePasswordUpdateSuccess]);

  // Enhanced handleLogout to include cleanup
  const handleLogoutWithCleanup = useCallback(() => {
    handleLogout();
    setActiveTab(TAB_NAMES.SUMMARY);
    // Reset initial pull flag on logout
    hasRunInitialPullRef.current = false;
    // Clear any running intervals
    if (batchIntervalRef.current) {
      clearInterval(batchIntervalRef.current);
      batchIntervalRef.current = null;
    }
    if (batchInitialTimeoutRef.current) {
      clearTimeout(batchInitialTimeoutRef.current);
      batchInitialTimeoutRef.current = null;
    }
  }, [handleLogout, batchIntervalRef, batchInitialTimeoutRef, hasRunInitialPullRef]);

  // Theme, color scheme, and Docker Hub credentials are now managed by hooks

  // Fetch cached data on page load/refresh (no Docker Hub calls)
  // This loads data from the database cache without triggering Docker Hub API calls
  // If no cache exists, backend will automatically fetch from Portainer (no Docker Hub)
  useEffect(() => {
    if (isAuthenticated && authToken && passwordChanged) {
      // Ensure axios header is set before fetching
      if (!axios.defaults.headers.common["Authorization"]) {
        axios.defaults.headers.common["Authorization"] = `Bearer ${authToken}`;
      }
      fetchColorScheme();
      fetchDockerHubCredentials();
      // Fetch data from backend (backend will return cache if available, or fetch from Portainer if not)
      // Only fetch if we haven't fetched yet (don't refetch after clearing)
      if (!dataFetched) {
        fetchContainers(false); // false = don't show loading, just load data (cache or Portainer)
      }
    }
  }, [
    isAuthenticated,
    authToken,
    passwordChanged,
    fetchColorScheme,
    fetchDockerHubCredentials,
    dataFetched,
    fetchContainers,
  ]);

  // Reset dataFetched and dockerHubDataPulled when logging out
  useEffect(() => {
    if (!isAuthenticated) {
      setDataFetched(false);
      setDockerHubDataPulled(false);
      localStorage.removeItem("dockerHubDataPulled");
      setPortainerInstancesFromAPI([]);
      // Clear batch interval on logout
      if (batchIntervalRef.current) {
        clearInterval(batchIntervalRef.current);
        batchIntervalRef.current = null;
      }
    }
  }, [
    isAuthenticated,
    setDataFetched,
    setDockerHubDataPulled,
    setPortainerInstancesFromAPI,
    batchIntervalRef,
  ]);

  // Batch config fetching is now handled by useBatchConfig hook

  // Batch processing (polling, handleBatchPull, handleBatchTrackedAppsCheck, interval setup)
  // is now handled by useBatchProcessing hook

  // fetchTrackedImages is now provided by useTrackedImages hook

  // handleBatchTrackedAppsCheck is now provided by useBatchProcessing hook

  // Fetch Portainer instances and avatar on app load
  useEffect(() => {
    if (isAuthenticated && authToken) {
      fetchPortainerInstances();
      fetchAvatar();
      fetchRecentAvatars();
      fetchTrackedImages();
    }
  }, [
    isAuthenticated,
    authToken,
    fetchPortainerInstances,
    fetchAvatar,
    fetchRecentAvatars,
    fetchTrackedImages,
  ]);

  // fetchAvatar and fetchRecentAvatars are now provided by useAvatarManagement hook

  // Close avatar menu and notification menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        showAvatarMenu &&
        !event.target.closest(".avatar-menu") &&
        !event.target.closest(".avatar-button") &&
        !event.target.closest("[data-username-role]")
      ) {
        setShowAvatarMenu(false);
      }
      if (
        showNotificationMenu &&
        !event.target.closest(".notification-menu") &&
        !event.target.closest(".notification-button")
      ) {
        setShowNotificationMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showAvatarMenu, showNotificationMenu]);

  // fetchContainers and fetchUnusedImages are now provided by useContainersData hook
  // handleClear is now provided by useContainerOperations hook

  const handleClearGitHubCache = useCallback(async () => {
    if (
      !window.confirm(
        "Are you sure you want to clear the latest version data for all tracked apps? This will reset the 'Latest' version information and force fresh data to be fetched on the next check."
      )
    ) {
      return;
    }

    try {
      setClearingGitHubCache(true);
      console.log("🗑️ Clearing latest version data for tracked apps...");

      const response = await axios.delete(`${API_BASE_URL}/api/tracked-images/cache`);

      if (response.data && response.data.success) {
        console.log("✅ Latest version data cleared successfully");
        const message = response.data.message || "Latest version data cleared successfully";
        console.log(message);

        // Refresh tracked images to show updated data
        await fetchTrackedImages();
      } else {
        console.error("Failed to clear latest version data");
      }
    } catch (err) {
      const errorMessage =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        "Failed to clear latest version data";
      console.error("Error clearing latest version data:", err);
      console.error(errorMessage);
    } finally {
      setClearingGitHubCache(false);
    }
  }, [fetchTrackedImages]);

  // handlePull is now provided by useContainerOperations hook

  const handleReorderTabs = async (fromIndex, toIndex) => {
    // Get current instances from API to ensure we have IDs
    try {
      const instancesResponse = await axios.get(`${API_BASE_URL}/api/portainer/instances`);
      const apiInstances = instancesResponse.data.instances || [];

      if (apiInstances.length === 0) return;

      // Create new order array based on current API instances
      const newOrder = [...apiInstances];
      const [moved] = newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, moved);

      // Build orders array for API
      const orders = newOrder.map((instance, index) => ({
        id: instance.id,
        display_order: index,
      }));

      await axios.post(`${API_BASE_URL}/api/portainer/instances/reorder`, {
        orders,
      });
      // Refresh containers to get updated order
      fetchContainers();
    } catch (err) {
      console.error("Error reordering tabs:", err);
    }
  };

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
    notificationCount,
    trackedAppsStats,
    dismissedTrackedAppNotifications,
    handleDismissContainerNotification,
    handleDismissTrackedAppNotification,
  } = useNotifications(containers, trackedImages);

  const { trackedAppsBehind } = trackedAppsStats;

  // Memoize filtered containers to avoid recalculating on every render
  const containersWithUpdates = useMemo(() => containers.filter((c) => c.hasUpdate), [containers]);

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
  }, [activeTab, portainerInstances, portainerInstancesFromAPI, portainerInstancesLoading]);

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

  // Calculate aggregated containers for selected instances (for header Select All)
  // Note: This is calculated but not currently used - kept for potential future use
  // eslint-disable-next-line no-unused-vars
  const aggregatedContainersWithUpdates = useMemo(() => {
    const instancesToShow =
      selectedPortainerInstances.size > 0
        ? portainerInstances.filter((inst) => selectedPortainerInstances.has(inst.name))
        : portainerInstances;

    let allContainersWithUpdates = [];
    instancesToShow.forEach((instance) => {
      const portainerUrl = instance?.url;
      const portainerData = portainerUrl ? containersByPortainer[portainerUrl] : null;
      if (portainerData?.withUpdates) {
        allContainersWithUpdates = allContainersWithUpdates.concat(portainerData.withUpdates);
      }
    });
    return allContainersWithUpdates;
  }, [selectedPortainerInstances, portainerInstances, containersByPortainer]);

  // Calculate filtered unused images for selected instances (for header Select All)
  // Note: This is calculated but not currently used - kept for potential future use
  // eslint-disable-next-line no-unused-vars
  const portainerUnusedImagesFiltered = useMemo(() => {
    const instancesToShow =
      selectedPortainerInstances.size > 0
        ? portainerInstances.filter((inst) => selectedPortainerInstances.has(inst.name))
        : portainerInstances;

    const selectedUrls = new Set(instancesToShow.map((inst) => inst?.url).filter(Boolean));
    return unusedImages.filter((img) => selectedUrls.has(img.portainerUrl));
  }, [selectedPortainerInstances, portainerInstances, unusedImages]);

  // Portainer instances are already sorted in usePortainerInstances hook

  // unusedImagesByPortainer is now calculated in useSummaryStats hook

  // Enhanced navigation handlers with menu-closing logic
  // Note: These are defined but not currently used - kept for potential future use
  // eslint-disable-next-line no-unused-vars
  const handleNavigateToPortainerWithMenu = useCallback(
    (container) => {
      setShowNotificationMenu(false);
      handleNavigateToPortainer(container);
    },
    [handleNavigateToPortainer]
  );

  // eslint-disable-next-line no-unused-vars
  const handleNavigateToTrackedAppsWithMenu = useCallback(() => {
    setShowNotificationMenu(false);
    handleNavigateToTrackedApps();
  }, [handleNavigateToTrackedApps]);

  // eslint-disable-next-line no-unused-vars
  const handleNavigateToSummaryWithMenu = useCallback(() => {
    setShowNotificationMenu(false);
    setShowAvatarMenu(false);
    handleNavigateToSummary();
  }, [handleNavigateToSummary]);

  // eslint-disable-next-line no-unused-vars
  const handleNavigateToSettingsWithMenu = useCallback(() => {
    setShowAvatarMenu(false);
    handleNavigateToSettings();
  }, [handleNavigateToSettings]);

  // eslint-disable-next-line no-unused-vars
  const handleNavigateToBatchWithMenu = useCallback(() => {
    setActiveTab(TAB_NAMES.CONFIGURATION);
    setConfigurationTab(CONFIGURATION_TABS.HISTORY);
    setShowAvatarMenu(false);
  }, [setActiveTab, setConfigurationTab, setShowAvatarMenu]);

  // Summary statistics are now calculated in the useSummaryStats hook within SummaryPage component

  // renderStackGroup removed - functionality moved to PortainerStackGroup component
  // renderPortainerTab removed - functionality moved to PortainerPage component

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

  // Settings page is now handled by SettingsPage component

  // Render summary page - now using SummaryPage component
  const renderSummary = useCallback(() => {
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
      />
    );
  }, [
    portainerInstances,
    containers,
    unusedImages,
    unusedImagesCount,
    trackedImages,
    dismissedTrackedAppNotifications,
    setActiveTab,
    setSelectedPortainerInstances,
    setContentTab,
  ]);

  // Render Tracked Apps tab - now using TrackedAppsPage component
  const renderTrackedApps = useCallback(() => {
    return (
      <TrackedAppsPage
        onDeleteTrackedImage={fetchTrackedImages}
        onUpgradeTrackedImage={fetchTrackedImages}
        onEditTrackedImage={fetchTrackedImages}
      />
    );
  }, [fetchTrackedImages]);

  // OLD renderTrackedApps function removed - functionality moved to TrackedAppsPage component
  // The old function was ~870 lines and has been completely replaced
  // renderPortainerTab removed - functionality moved to PortainerPage component

  // Render main content based on activeTab
  // Note: This function is defined but not currently used - kept for potential future use
  // eslint-disable-next-line no-unused-vars
  const renderContent = () => {
    if (activeTab === "summary") {
      return (
        <SummaryPage
          containers={containers}
          stacks={stacks}
          loading={loading}
          error={error}
          unusedImagesCount={unusedImagesCount}
          portainerInstances={portainerInstances}
          portainerInstancesLoading={portainerInstancesLoading}
          dockerHubDataPulled={dockerHubDataPulled}
          lastPullTime={lastPullTime}
          trackedAppsStats={trackedAppsStats}
          onNavigateToPortainer={handleNavigateToPortainer}
          onNavigateToTrackedApps={handleNavigateToTrackedApps}
          onPullDockerHub={handlePull}
          pullingDockerHub={pulling}
          pullError={pullError}
          pullSuccess={pullSuccess}
          onClearCache={handleClear}
          onClearGitHubCache={handleClearGitHubCache}
          onAddPortainerInstance={() => {
            setEditingPortainerInstance(null);
            setShowAddPortainerModal(true);
          }}
        />
      );
    } else if (activeTab === "portainer") {
      return (
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
          onAddInstance={() => {
            setEditingPortainerInstance(null);
            setShowAddPortainerModal(true);
          }}
          onPullDockerHub={handlePull}
          pullingDockerHub={pulling}
          pullError={pullError}
          pullSuccess={pullSuccess}
          onUpgrade={handleUpgrade}
          upgrading={upgrading}
          onBatchUpgrade={handleBatchUpgrade}
          batchUpgrading={batchUpgrading}
          onDeleteImage={handleDeleteImage}
          onDeleteImages={handleDeleteImages}
          deletingImages={deletingImages}
          onToggleSelect={handleToggleSelect}
          onSelectAll={handleSelectAll}
          onToggleStackSelect={toggleStack}
          selectedContainers={selectedContainers}
          selectedImages={selectedImages}
          onToggleImageSelect={handleToggleImageSelect}
          onSelectAllImages={handleSelectAllImages}
          collapsedStacks={collapsedStacks}
          contentTab={contentTab}
          onContentTabChange={setContentTab}
          selectedPortainerInstances={selectedPortainerInstances}
          onSelectedPortainerInstancesChange={setSelectedPortainerInstances}
          onReorderTabs={handleReorderTabs}
          draggedTabIndex={draggedTabIndex}
          onDraggedTabIndexChange={setDraggedTabIndex}
          onNavigateToSettings={handleNavigateToSettings}
          onSetSettingsTab={setSettingsTab}
        />
      );
    } else if (activeTab === "tracked-apps") {
      return (
        <TrackedAppsPage
          trackedImages={trackedImages}
          fetchTrackedImages={fetchTrackedImages}
          onClearGitHubCache={handleClearGitHubCache}
          clearingGitHubCache={clearingGitHubCache}
          dismissedTrackedAppNotifications={dismissedTrackedAppNotifications}
          onDismissTrackedAppNotification={handleDismissTrackedAppNotification}
        />
      );
    } else if (activeTab === "settings") {
      return (
        <SettingsPage
          username={username}
          userRole={userRole}
          avatar={avatar}
          recentAvatars={recentAvatars}
          onUsernameUpdate={handleUsernameUpdate}
          onPasswordUpdateSuccess={handlePasswordUpdateSuccessWithNavigation}
          onAvatarChange={handleAvatarChange}
          onFetchRecentAvatars={fetchRecentAvatars}
          onFetchAvatar={fetchAvatar}
          settingsTab={settingsTab}
          onSettingsTabChange={setSettingsTab}
          dockerHubCredentials={dockerHubCredentials}
          onDockerHubCredentialsUpdate={setDockerHubCredentials}
          onFetchDockerHubCredentials={fetchDockerHubCredentials}
          batchConfig={batchConfig}
          onBatchConfigUpdate={handleBatchConfigUpdate}
          colorScheme={colorScheme}
          onColorSchemeChange={handleColorSchemeChange}
          onClearPortainerData={handleClear}
          onClearTrackedAppData={handleClearGitHubCache}
          onEditInstance={(instance) => {
            setEditingPortainerInstance(instance);
            setShowAddPortainerModal(true);
          }}
          editingPortainerInstance={editingPortainerInstance}
        />
      );
    } else if (activeTab === "configuration") {
      return (
        <BatchPage
          configurationTab={configurationTab}
          onConfigurationTabChange={setConfigurationTab}
          batchConfig={batchConfig}
          onBatchConfigUpdate={handleBatchConfigUpdate}
          onTriggerBatchPull={handleBatchPull}
          onTriggerTrackedAppsCheck={handleBatchTrackedAppsCheck}
        />
      );
    } else if (activeTab === "batch-logs") {
      return <BatchLogs />;
    }
    return null;
  };

  // Axios interceptor and auth token setup are now handled by useAuth hook

  // Create a HomePage component that contains the main app content
  const HomePage = () => (
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
          showNotificationMenu={showNotificationMenu}
          showAvatarMenu={showAvatarMenu}
          onToggleNotificationMenu={(show) => {
            if (show !== undefined) {
              setShowNotificationMenu(show);
              if (show) setShowAvatarMenu(false);
            } else {
              // Toggle behavior if no boolean provided
              setShowNotificationMenu((prev) => {
                if (!prev) setShowAvatarMenu(false);
                return !prev;
              });
            }
          }}
          onToggleAvatarMenu={(show) => {
            if (show !== undefined) {
              setShowAvatarMenu(show);
              if (show) setShowNotificationMenu(false);
            } else {
              // Toggle behavior if no boolean provided
              setShowAvatarMenu((prev) => {
                if (!prev) setShowNotificationMenu(false);
                return !prev;
              });
            }
          }}
          onNavigateToSummary={handleNavigateToSummary}
          onNavigateToSettings={handleNavigateToSettings}
          onNavigateToBatch={handleNavigateToBatch}
          onNavigateToPortainer={handleNavigateToPortainer}
          onNavigateToTrackedApps={handleNavigateToTrackedApps}
          onDismissContainerNotification={handleDismissContainerNotification}
          onDismissTrackedAppNotification={handleDismissTrackedAppNotification}
          onTemporaryThemeToggle={handleTemporaryThemeToggle}
          onLogout={handleLogoutWithCleanup}
          API_BASE_URL={API_BASE_URL}
        />

        <div className="container">
          {/* Tabs - Show for all tabs except old settings page, configuration, and batch logs */}
          {activeTab !== TAB_NAMES.SETTINGS &&
            activeTab !== TAB_NAMES.CONFIGURATION &&
            activeTab !== TAB_NAMES.BATCH_LOGS && (
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
                username={username}
                passwordChanged={passwordChanged}
                avatar={avatar}
                recentAvatars={recentAvatars}
                onUsernameUpdate={handleUsernameUpdate}
                onLogout={handleLogoutWithCleanup}
                onPasswordUpdateSuccess={handlePasswordUpdateSuccessWithNavigation}
                onPortainerInstancesChange={async () => {
                  await fetchPortainerInstances();
                  // Fetch from cache (which has been updated by the delete handler)
                  // This preserves Docker Hub update data for remaining instances
                  await fetchContainers(false);
                }}
                onAvatarChange={handleAvatarChange}
                onRecentAvatarsChange={(avatars) => {
                  setRecentAvatars(avatars);
                  // Refresh recent avatars from server to get latest
                  fetchRecentAvatars();
                }}
                onAvatarUploaded={async () => {
                  await fetchAvatar();
                }}
                onBatchConfigUpdate={handleBatchConfigUpdate}
                colorScheme={colorScheme}
                onColorSchemeChange={handleColorSchemeChange}
                onClearPortainerData={handleClear}
                onClearTrackedAppData={handleClearGitHubCache}
                onEditInstance={(instance) => {
                  setEditingPortainerInstance(instance);
                  setShowAddPortainerModal(true);
                }}
                editingPortainerInstance={editingPortainerInstance}
                refreshInstances={
                  editingPortainerInstance === null ? fetchPortainerInstances : null
                }
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

                {/* Error display - handles both rate limit and other errors */}
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

                {/* Render summary page even when there's an error (error modal will overlay) */}
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
                        onAddInstance={() => {
                          setEditingPortainerInstance(null);
                          setShowAddPortainerModal(true);
                        }}
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
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="version-footer-wrapper">
          <VersionFooter version={version} isDevBuild={isDevBuild} />
        </div>

        <ErrorBoundary>
          <AddPortainerModal
            isOpen={showAddPortainerModal}
            onClose={() => {
              setShowAddPortainerModal(false);
              setEditingPortainerInstance(null);
            }}
            onSuccess={async (newInstanceData) => {
              // Refresh Portainer instances list and get the updated instances
              const updatedInstances = await fetchPortainerInstances();

              // If this is a new instance (not editing), fetch data for it
              if (!editingPortainerInstance && newInstanceData) {
                // Find the new instance in the updated list to get the correct name
                // The name might be different if backend used hostname as default
                const newInstance = updatedInstances.find(
                  (inst) => inst.id === newInstanceData.id || inst.url === newInstanceData.url
                );

                // Ensure the instance is in state before setting active tab to prevent safety check redirect
                if (updatedInstances.length > 0) {
                  setPortainerInstancesFromAPI(updatedInstances);
                }

                // Use the found instance or fallback to newInstanceData
                const instanceToUse = newInstance || newInstanceData;
                await handleNewInstanceDataFetch(instanceToUse);
              } else {
                // For edits, just refresh all data
                fetchContainers();
              }

              setEditingPortainerInstance(null);

              // Trigger refresh in Settings component to update the auth method badges
              // If we're on the settings page, trigger a refresh
              if (activeTab === TAB_NAMES.SETTINGS && settingsTab === SETTINGS_TABS.PORTAINER) {
                // The Settings component will refresh when the portainer section is active
                // But we can also force a refresh by calling fetchPortainerInstances
                // which will update App's state, and Settings will pick it up
                await fetchPortainerInstances();
              }
            }}
            initialData={editingPortainerInstance}
            instanceId={editingPortainerInstance?.id || null}
          />
        </ErrorBoundary>
      </div>

      {/* AddTrackedImageModal is now managed by TrackedAppsPage component */}
    </BatchConfigContext.Provider>
  );

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

  // If password not changed, force settings page
  if (!passwordChanged) {
    return (
      <div className="App">
        <header className="App-header">
          <div className="header-content">
            <div>
              <h1>
                <img
                  src="/img/logo.png"
                  alt="Docked"
                  style={{ height: "1.9em", verticalAlign: "middle", marginRight: "12px" }}
                />
                <img
                  src="/img/text-header.png"
                  alt="docked"
                  style={{ height: "1.25em", verticalAlign: "middle", maxWidth: "50%" }}
                />
              </h1>
              <p>Portainer Container Manager</p>
            </div>
          </div>
        </header>
        <div className="container">
          <Settings
            username={username}
            onUsernameUpdate={handleUsernameUpdate}
            onLogout={handleLogoutWithCleanup}
            isFirstLogin={true}
            avatar={avatar}
            recentAvatars={recentAvatars}
            onAvatarChange={handleAvatarChange}
            onRecentAvatarsChange={(avatars) => {
              setRecentAvatars(avatars);
              fetchRecentAvatars();
            }}
            onAvatarUploaded={async () => {
              await fetchAvatar();
            }}
            onPasswordUpdateSuccess={handlePasswordUpdateSuccessWithNavigation}
            onPortainerInstancesChange={() => {
              fetchPortainerInstances();
              fetchContainers();
            }}
            onBatchConfigUpdate={handleBatchConfigUpdate}
          />
        </div>
      </div>
    );
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
              showNotificationMenu,
              showAvatarMenu,
              onToggleNotificationMenu: (show) => {
                if (show !== undefined) {
                  setShowNotificationMenu(show);
                  if (show) setShowAvatarMenu(false);
                } else {
                  setShowNotificationMenu((prev) => {
                    if (!prev) setShowAvatarMenu(false);
                    return !prev;
                  });
                }
              },
              onToggleAvatarMenu: (show) => {
                if (show !== undefined) {
                  setShowAvatarMenu(show);
                  if (show) setShowNotificationMenu(false);
                } else {
                  setShowAvatarMenu((prev) => {
                    if (!prev) setShowNotificationMenu(false);
                    return !prev;
                  });
                }
              },
              onDismissContainerNotification: handleDismissContainerNotification,
              onDismissTrackedAppNotification: handleDismissTrackedAppNotification,
              onTemporaryThemeToggle: handleTemporaryThemeToggle,
              onLogout: handleLogoutWithCleanup,
            }}
            settingsProps={{
              username,
              passwordChanged,
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
              onEditInstance: (instance) => {
                setEditingPortainerInstance(instance);
                setShowAddPortainerModal(true);
              },
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
      <Route path="/" element={<HomePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Export the context for use in other components
// BatchConfigContext is exported from contexts/BatchConfigContext.js

export default App;

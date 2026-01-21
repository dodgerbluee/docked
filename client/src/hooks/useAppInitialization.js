import { useEffect, useRef } from "react";
import axios from "axios";

/**
 * useAppInitialization Hook
 * Handles all initialization effects for the app
 */
export function useAppInitialization({
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
}) {
  // Track if initial fetch has been done to prevent re-fetching on every render
  const initialFetchDoneRef = useRef(false);

  // Fetch cached data on page load/refresh (no Docker Hub calls)
  useEffect(() => {
    if (isAuthenticated && authToken && !initialFetchDoneRef.current) {
      // Ensure axios header is set before fetching
      if (!axios.defaults.headers.common["Authorization"]) {
        axios.defaults.headers.common["Authorization"] = `Bearer ${authToken}`;
      }
      fetchColorScheme();
      // Fetch data from backend (backend will return cache if available, or fetch from Portainer if not)
      // Only fetch once on initial mount
      initialFetchDoneRef.current = true;
      fetchContainers(false); // false = don't show loading, just load data (cache or Portainer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAuthenticated,
    authToken,
    // Note: fetchContainers is intentionally excluded from deps to prevent re-fetching
    // when it's recreated due to container state changes (e.g., after clearing cache)
    // We use initialFetchDoneRef to ensure this only runs once on mount
  ]);

  // Reset initial fetch flag and dataFetched when logging out
  useEffect(() => {
    if (!isAuthenticated) {
      initialFetchDoneRef.current = false;
      setDataFetched(false);
      setDockerHubDataPulled(false);
      localStorage.removeItem("dockerHubDataPulled");
      setPortainerInstancesFromAPI([]);
      // Clear all container and tracked image data to prevent showing previous user's data
      setContainers([]);
      setStacks([]);
      setUnusedImages([]);
      setUnusedImagesCount(0);
      setTrackedApps([]);
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
    setContainers,
    setStacks,
    setUnusedImages,
    setUnusedImagesCount,
    setTrackedApps,
    batchIntervalRef,
  ]);

  // Fetch Portainer instances and avatar on app load
  useEffect(() => {
    if (isAuthenticated && authToken) {
      fetchPortainerInstances();
      fetchAvatar();
      fetchRecentAvatars();
      fetchTrackedApps();
    }
  }, [
    isAuthenticated,
    authToken,
    fetchPortainerInstances,
    fetchAvatar,
    fetchRecentAvatars,
    fetchTrackedApps,
  ]);

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
  }, [showAvatarMenu, showNotificationMenu, setShowAvatarMenu, setShowNotificationMenu]);
}

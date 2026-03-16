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
      // Fetch data from backend (backend will return cache if available, or fetch from source if not)
      // Only fetch once on initial mount
      initialFetchDoneRef.current = true;
      fetchContainers(true); // true = show loading skeleton on cold cache (guard in useContainersData only fires when containers empty + not yet fetched)
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
      secondaryFetchDoneRef.current = false;
      setDataFetched(false);
      setDockerHubDataPulled(false);
      localStorage.removeItem("dockerHubDataPulled");
      setSourceInstancesFromAPI([]);
      // Clear all container and tracked image data to prevent showing previous user's data
      setContainers([]);
      setStacks([]);
      setUnusedImages([]);
      setUnusedImagesCount(0);
      setTrackedApps([]);
    }
  }, [
    isAuthenticated,
    setDataFetched,
    setDockerHubDataPulled,
    setSourceInstancesFromAPI,
    setContainers,
    setStacks,
    setUnusedImages,
    setUnusedImagesCount,
    setTrackedApps,
  ]);

  // Fetch source instances and avatar on app load (once only)
  const secondaryFetchDoneRef = useRef(false);
  useEffect(() => {
    if (isAuthenticated && authToken && !secondaryFetchDoneRef.current) {
      secondaryFetchDoneRef.current = true;
      fetchSourceInstances();
      fetchAvatar();
      fetchRecentAvatars();
      // Note: fetchTrackedApps is NOT called here because useTrackedApps
      // already auto-fetches on mount via its own useEffect. Calling it
      // here would cause a duplicate API request.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, authToken]);

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

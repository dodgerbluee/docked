import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  createContext,
  useContext,
  useMemo,
  Suspense,
  lazy,
} from "react";
import axios from "axios";
import "./App.css";
import Login from "./components/Login";
import ErrorBoundary from "./components/ErrorBoundary";
import {
  getDockerHubUrl,
  getDockerHubTagsUrl,
  getGitHubRepoUrl,
  formatTimeAgo,
} from "./utils/formatters";

// Lazy load heavy components
// Temporarily disabled to debug React error #426
// const Settings = lazy(() => import("./components/Settings"));
// const AddPortainerModal = lazy(() => import("./components/AddPortainerModal"));
// const BatchLogs = lazy(() => import("./components/BatchLogs"));
import Settings from "./components/Settings";
import AddPortainerModal from "./components/AddPortainerModal";
import BatchLogs from "./components/BatchLogs";

// In production, API is served from same origin, so use relative URLs
// In development, use localhost
const API_BASE_URL =
  process.env.REACT_APP_API_URL ||
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");

// Create Context for batch config
const BatchConfigContext = createContext(null);

function App() {
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    // Check if user is already logged in
    return !!localStorage.getItem("authToken");
  });
  const [authToken, setAuthToken] = useState(() => {
    const token = localStorage.getItem("authToken");
    // Set axios header immediately if token exists
    if (token) {
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    }
    return token || null;
  });
  const [username, setUsername] = useState(() => {
    return localStorage.getItem("username") || null;
  });
  const [userRole, setUserRole] = useState(() => {
    return localStorage.getItem("userRole") || "Administrator";
  });
  const [passwordChanged, setPasswordChanged] = useState(() => {
    const stored = localStorage.getItem("passwordChanged");
    // If not in localStorage, check if we need to fetch from API
    if (stored === null && localStorage.getItem("authToken")) {
      // Will be set after login response
      return false;
    }
    return stored === "true";
  });
  const [showAddPortainerModal, setShowAddPortainerModal] = useState(false);
  const [editingPortainerInstance, setEditingPortainerInstance] =
    useState(null);
  const [draggedTabIndex, setDraggedTabIndex] = useState(null);
  const [dataFetched, setDataFetched] = useState(false); // Track if data has been fetched
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general"); // 'general', 'username', 'password', 'portainer', 'dockerhub', 'avatar', 'batch'

  const [containers, setContainers] = useState([]);
  const [stacks, setStacks] = useState([]);
  const [loading, setLoading] = useState(false); // Start as false - only show loading when actually fetching
  const [error, setError] = useState(null);
  const [portainerInstancesFromAPI, setPortainerInstancesFromAPI] = useState(
    []
  );
  const [portainerInstancesLoading, setPortainerInstancesLoading] =
    useState(false);
  const [upgrading, setUpgrading] = useState({});
  const [selectedContainers, setSelectedContainers] = useState(new Set());
  const [batchUpgrading, setBatchUpgrading] = useState(false);
  const [activeTab, setActiveTab] = useState("summary");
  const [contentTab, setContentTab] = useState("updates"); // "updates", "current", "unused"
  const [collapsedStacks, setCollapsedStacks] = useState(new Set());
  const [unusedImages, setUnusedImages] = useState([]);
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [deletingImages, setDeletingImages] = useState(false);
  const [unusedImagesCount, setUnusedImagesCount] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [loadingInstances, setLoadingInstances] = useState(new Set()); // Track loading state per instance
  const [dockerHubDataPulled, setDockerHubDataPulled] = useState(() => {
    // Check localStorage for saved state
    const saved = localStorage.getItem("dockerHubDataPulled");
    return saved ? JSON.parse(saved) : false;
  });
  // Color scheme preference: 'system', 'light', or 'dark'
  const [colorScheme, setColorScheme] = useState(() => {
    // Check localStorage for saved preference, default to 'system'
    const saved = localStorage.getItem("colorScheme");
    return saved || "system";
  });

  // Derived dark mode state based on color scheme preference
  const [darkMode, setDarkMode] = useState(() => {
    if (colorScheme === "system") {
      // Check system preference
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return colorScheme === "dark";
  });
  const [avatar, setAvatar] = useState("/img/default-avatar.jpg");
  const [recentAvatars, setRecentAvatars] = useState([]);

  // Store avatar in ref to access current value without causing callback recreation
  const avatarRef = useRef(avatar);
  useEffect(() => {
    avatarRef.current = avatar;
  }, [avatar]);

  // Batch processing state
  const [batchConfig, setBatchConfig] = useState({
    enabled: false,
    intervalMinutes: 60,
  });

  // Memoize context value to ensure React detects changes
  // MUST be called before any early returns (React Hooks rule)
  // Only depend on batchConfig - setBatchConfig is stable from useState
  const batchConfigContextValue = useMemo(
    () => ({
      batchConfig,
      setBatchConfig,
    }),
    [batchConfig]
  );

  const batchIntervalRef = useRef(null);
  const batchInitialTimeoutRef = useRef(null);
  const hasRunInitialPullRef = useRef(false); // Track if initial pull has run in this session

  // Memoize avatar change handler to prevent it from being recreated on every render
  // Use ref to access current avatar value to avoid dependency on avatar state
  // This ensures the callback reference stays stable and Settings always receives it
  const handleAvatarChange = useCallback(
    async (newAvatar) => {
      const currentAvatar = avatarRef.current;

      // If it's a blob URL, revoke the old one
      if (currentAvatar && currentAvatar.startsWith("blob:")) {
        URL.revokeObjectURL(currentAvatar);
      }

      // If it's the default avatar, set it directly
      if (newAvatar === "/img/default-avatar.jpg") {
        setAvatar(newAvatar);
        return;
      }

      // If it's an API endpoint, fetch it as a blob to create a fresh blob URL
      // This ensures the image updates immediately without browser caching issues
      // Add timestamp to cache-bust and ensure we get the latest version
      if (newAvatar && newAvatar.startsWith("/api/avatars")) {
        try {
          const cacheBustUrl = `${newAvatar}?t=${Date.now()}`;
          const response = await axios.get(`${API_BASE_URL}${cacheBustUrl}`, {
            responseType: "blob",
          });
          const blobUrl = URL.createObjectURL(response.data);
          setAvatar(blobUrl);
        } catch (err) {
          console.error("Error fetching updated avatar:", err);
          // Fallback to default on error
          setAvatar("/img/default-avatar.jpg");
        }
      } else {
        // For other URLs (blob URLs, http URLs, etc.), set directly
        setAvatar(newAvatar);
      }
    },
    [] // Empty deps - use ref to access current avatar value
  );

  // Memoize batch config update callback to prevent it from being recreated on every render
  const handleBatchConfigUpdate = useCallback(async () => {
    // Refetch batch config after update
    try {
      const response = await axios.get(`${API_BASE_URL}/api/batch/config`);
      if (response.data.success) {
        const newConfig = {
          enabled: response.data.config.enabled || false,
          intervalMinutes: response.data.config.intervalMinutes || 60,
        };
        // Force state update with new object - this will trigger Context update
        setBatchConfig((prev) => {
          // Always return new object to ensure React detects the change
          if (
            prev.enabled !== newConfig.enabled ||
            prev.intervalMinutes !== newConfig.intervalMinutes
          ) {
            return newConfig;
          }
          return { ...newConfig };
        });
      }
    } catch (err) {
      console.error("Error refetching batch config:", err);
    }
  }, [batchConfig]);

  // Handle login
  const handleLogin = (token, user, pwdChanged) => {
    // Set axios header immediately before state updates
    axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;

    setAuthToken(token);
    setUsername(user);
    setPasswordChanged(pwdChanged);
    setIsAuthenticated(true);

    // If password not changed, show settings immediately with password section
    if (!pwdChanged) {
      setActiveTab("settings");
      setSettingsTab("password");
    }
  };

  // Handle username update
  const handleUsernameUpdate = (newUsername, newToken = null) => {
    setUsername(newUsername);
    localStorage.setItem("username", newUsername);
    // If server provided a new token (with user ID), use it
    // Otherwise, fallback to old token generation (for backwards compatibility)
    if (newToken) {
      setAuthToken(newToken);
      localStorage.setItem("authToken", newToken);
      axios.defaults.headers.common["Authorization"] = `Bearer ${newToken}`;
    } else {
      // Fallback: generate token with username (old format)
      // This should not happen with updated backend, but kept for safety
      const token = Buffer.from(`${newUsername}:${Date.now()}`).toString(
        "base64"
      );
      setAuthToken(token);
      localStorage.setItem("authToken", token);
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    }
  };

  // Handle password update success
  const handlePasswordUpdateSuccess = () => {
    setPasswordChanged(true);
    localStorage.setItem("passwordChanged", "true");
    setActiveTab("summary");
  };

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("username");
    localStorage.removeItem("passwordChanged");
    setAuthToken(null);
    setUsername(null);
    setUserRole("Administrator");
    setPasswordChanged(false);
    setIsAuthenticated(false);
    setActiveTab("summary");
    // Clear axios defaults
    delete axios.defaults.headers.common["Authorization"];
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
  };

  // Update dark mode based on color scheme preference
  useEffect(() => {
    if (colorScheme === "system") {
      // Listen to system preference changes
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = (e) => {
        setDarkMode(e.matches);
      };

      // Set initial value
      setDarkMode(mediaQuery.matches);

      // Listen for changes
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", handleChange);
        return () => mediaQuery.removeEventListener("change", handleChange);
      } else {
        // Fallback for older browsers
        mediaQuery.addListener(handleChange);
        return () => mediaQuery.removeListener(handleChange);
      }
    } else {
      // Use explicit preference
      setDarkMode(colorScheme === "dark");
    }
  }, [colorScheme]);

  // Update body class when dark mode changes
  useEffect(() => {
    if (darkMode) {
      document.body.classList.add("dark-mode");
    } else {
      document.body.classList.remove("dark-mode");
    }
  }, [darkMode]);

  // Handle color scheme preference change from Settings
  const handleColorSchemeChange = useCallback((newColorScheme) => {
    setColorScheme(newColorScheme);
    localStorage.setItem("colorScheme", newColorScheme);
  }, []);

  // Fetch cached data on page load/refresh (no Docker Hub calls)
  // This loads data from the database cache without triggering Docker Hub API calls
  // If no cache exists, backend will automatically fetch from Portainer (no Docker Hub)
  useEffect(() => {
    if (isAuthenticated && authToken && passwordChanged) {
      // Ensure axios header is set before fetching
      if (!axios.defaults.headers.common["Authorization"]) {
        axios.defaults.headers.common["Authorization"] = `Bearer ${authToken}`;
      }
      // Fetch data from backend (backend will return cache if available, or fetch from Portainer if not)
      // Only fetch if we haven't fetched yet (don't refetch after clearing)
      if (!dataFetched) {
        fetchContainers(false); // false = don't show loading, just load data (cache or Portainer)
      }
    }
  }, [isAuthenticated, authToken, passwordChanged]);

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
  }, [isAuthenticated]);

  // Fetch batch configuration
  useEffect(() => {
    if (isAuthenticated && authToken && passwordChanged) {
      const fetchBatchConfig = async () => {
        try {
          const response = await axios.get(`${API_BASE_URL}/api/batch/config`);
          if (response.data.success) {
            setBatchConfig({
              enabled: response.data.config.enabled || false,
              intervalMinutes: response.data.config.intervalMinutes || 60,
            });
          }
        } catch (err) {
          console.error("Error fetching batch config:", err);
        }
      };
      fetchBatchConfig();
    }
  }, [isAuthenticated, authToken, passwordChanged]);

  // Handle batch pull with logging - memoized to prevent unnecessary re-renders
  // MUST be defined before the useEffect that uses it
  const handleBatchPull = useCallback(async () => {
    let runId = null;
    const logs = [];

    const log = (message) => {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${message}`;
      logs.push(logEntry);
      console.log(logEntry);
    };

    try {
      // Create batch run record
      log("Starting batch pull process...");
      const runResponse = await axios.post(`${API_BASE_URL}/api/batch/runs`, {
        status: "running",
        jobType: "docker-hub-pull",
      });
      runId = runResponse.data.runId;
      log(`Batch run ${runId} created`);

      setPulling(true);
      setError(null);
      log("🔄 Pulling fresh data from Docker Hub...");

      // Start the pull operation (don't await yet - let it run in background)
      log("Initiating Docker Hub API call...");
      const pullPromise = axios.post(
        `${API_BASE_URL}/api/containers/pull`,
        {},
        {
          timeout: 300000, // 5 minute timeout for large pulls
        }
      );

      // While pulling, fetch any existing cached data to show immediately
      // This allows the summary page to display while new data is being fetched
      log("Fetching cached data for immediate display...");
      try {
        const cachedResponse = await axios.get(
          `${API_BASE_URL}/api/containers`
        );
        if (cachedResponse.data.grouped && cachedResponse.data.stacks) {
          setContainers(cachedResponse.data.containers || []);
          setStacks(cachedResponse.data.stacks || []);
          setUnusedImagesCount(cachedResponse.data.unusedImagesCount || 0);

          if (cachedResponse.data.portainerInstances) {
            setPortainerInstancesFromAPI(
              cachedResponse.data.portainerInstances
            );
          }
          setDataFetched(true);
          log("Cached data loaded successfully");
        }
      } catch (cacheErr) {
        // If no cached data exists, that's okay - we'll show empty state
        log("No cached data available yet");
      }

      // Now wait for the pull to complete
      log("Waiting for Docker Hub pull to complete...");
      const response = await pullPromise;
      log("Docker Hub pull completed successfully");

      // Check if response has success flag
      if (response.data.success === false) {
        throw new Error(
          response.data.error ||
            response.data.message ||
            "Failed to pull container data"
        );
      }

      // Update state with fresh data
      let containersChecked = 0;
      let containersUpdated = 0;

      if (response.data.grouped && response.data.stacks) {
        setContainers(response.data.containers || []);
        setStacks(response.data.stacks || []);
        setUnusedImagesCount(response.data.unusedImagesCount || 0);

        if (response.data.portainerInstances) {
          setPortainerInstancesFromAPI(response.data.portainerInstances);
        }

        containersChecked = response.data.containers?.length || 0;
        containersUpdated =
          response.data.containers?.filter((c) => c.hasUpdate).length || 0;
        log(
          `Processed ${containersChecked} containers, ${containersUpdated} with updates available`
        );

        // Mark that Docker Hub data has been pulled
        setDockerHubDataPulled(true);
        localStorage.setItem("dockerHubDataPulled", JSON.stringify(true));
      } else {
        // Backward compatibility: treat as flat array
        setContainers(Array.isArray(response.data) ? response.data : []);
        setStacks([]);
        setUnusedImagesCount(0);
        containersChecked = Array.isArray(response.data)
          ? response.data.length
          : 0;
        log(`Processed ${containersChecked} containers (legacy format)`);
      }

      setError(null);
      setDataFetched(true);

      // Fetch unused images
      log("Fetching unused images...");
      await fetchUnusedImages();
      log("Unused images fetched");

      // Update batch run as completed
      if (runId) {
        await axios.put(`${API_BASE_URL}/api/batch/runs/${runId}`, {
          status: "completed",
          containersChecked,
          containersUpdated,
          logs: logs.join("\n"),
        });
        log(`Batch run ${runId} marked as completed`);
      }
    } catch (err) {
      let errorMessage = "Failed to pull container data";

      // Handle rate limit errors specially
      if (
        err.response?.status === 429 ||
        err.response?.data?.rateLimitExceeded
      ) {
        errorMessage =
          err.response?.data?.message ||
          err.response?.data?.error ||
          "Docker Hub rate limit exceeded. Please wait a few minutes before trying again, or configure Docker Hub credentials in Settings for higher rate limits.";
        log(`❌ Rate limit exceeded: ${errorMessage}`);
        setError(errorMessage);
        console.error("❌ Docker Hub rate limit exceeded:", errorMessage);
      } else {
        errorMessage =
          err.response?.data?.error ||
          err.response?.data?.message ||
          err.message ||
          "Failed to pull container data";
        log(`❌ Error: ${errorMessage}`);
        setError(errorMessage);
        console.error("Error pulling containers:", err);
        if (process.env.NODE_ENV === "development") {
          console.error("Error details:", {
            message: err.message,
            response: err.response?.data,
            status: err.response?.status,
          });
        }
      }

      // Update batch run as failed
      if (runId) {
        try {
          await axios.put(`${API_BASE_URL}/api/batch/runs/${runId}`, {
            status: "failed",
            errorMessage,
            logs: logs.join("\n"),
          });
          log(`Batch run ${runId} marked as failed`);
        } catch (updateErr) {
          console.error("Error updating batch run:", updateErr);
        }
      }
    } finally {
      setPulling(false);
      // Always log completion to help debug missed runs
      log("Batch pull process finished (success or failure)");
    }
  }, []); // Empty deps - fetchUnusedImages is stable, and we use setState functions which are stable

  // Set up batch processing interval
  useEffect(() => {
    // ALWAYS clear any existing interval and timeout FIRST to prevent old schedules from running
    // This is critical - we must clear before setting up new ones
    if (batchIntervalRef.current) {
      clearInterval(batchIntervalRef.current);
      batchIntervalRef.current = null;
    }
    if (batchInitialTimeoutRef.current) {
      clearTimeout(batchInitialTimeoutRef.current);
      batchInitialTimeoutRef.current = null;
    }

    // Only set up interval if batch is enabled and user is authenticated
    if (
      batchConfig.enabled &&
      isAuthenticated &&
      authToken &&
      passwordChanged &&
      batchConfig.intervalMinutes > 0
    ) {
      const intervalMs = batchConfig.intervalMinutes * 60 * 1000;

      // Set up the interval - use a fresh function reference
      // Capture the interval value in closure to ensure we use the correct one
      const currentIntervalMinutes = batchConfig.intervalMinutes;
      const intervalId = setInterval(() => {
        // Double-check we're still the active interval before running
        if (batchIntervalRef.current === intervalId) {
          // Note: We don't check if pulling is true here because:
          // 1. State updates are async and may not reflect current state
          // 2. Even if a previous run is still running, we want the interval to continue
          // 3. The handleBatchPull function handles its own state management

          // Trigger pull in background with logging
          // IMPORTANT: Always catch errors to ensure interval continues even if pull fails
          // The interval will continue running regardless of success or failure
          handleBatchPull().catch((err) => {
            console.error(
              "❌ Error in batch pull (interval will continue):",
              err
            );
          });
        } else {
          // Clear this interval if it's no longer active
          clearInterval(intervalId);
        }
      }, intervalMs);

      batchIntervalRef.current = intervalId;

      // Only trigger initial pull if we haven't run it recently (within last hour)
      // This prevents it from running on every page refresh
      // Check both localStorage (persists across refreshes) and session ref (current session)
      const lastInitialPull = localStorage.getItem("lastBatchInitialPull");
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      const lastPullTimestamp = lastInitialPull ? parseInt(lastInitialPull) : 0;
      const timeSinceLastPull =
        lastPullTimestamp > 0 ? now - lastPullTimestamp : Infinity;
      const shouldRunInitial =
        !lastInitialPull || lastPullTimestamp < oneHourAgo;

      // Don't run initial pull if:
      // 1. Already ran in this session, OR
      // 2. Ran within the last hour (check localStorage)
      if (!hasRunInitialPullRef.current && shouldRunInitial) {
        // Set the flag and localStorage IMMEDIATELY to prevent duplicate runs
        hasRunInitialPullRef.current = true;
        localStorage.setItem("lastBatchInitialPull", now.toString());

        const timeoutId = setTimeout(() => {
          handleBatchPull().catch((err) => {
            console.error("Error in initial batch pull:", err);
          });
          batchInitialTimeoutRef.current = null; // Clear ref after timeout fires
        }, 5000); // Wait 5 seconds after page load

        batchInitialTimeoutRef.current = timeoutId;
      }

      // Cleanup function - runs when effect re-runs or component unmounts
      return () => {
        if (batchIntervalRef.current) {
          clearInterval(batchIntervalRef.current);
          batchIntervalRef.current = null;
        }
        if (batchInitialTimeoutRef.current) {
          clearTimeout(batchInitialTimeoutRef.current);
          batchInitialTimeoutRef.current = null;
        }
      };
    } else if (batchIntervalRef.current || batchInitialTimeoutRef.current) {
      // If batch is disabled, clear everything
      if (batchIntervalRef.current) {
        clearInterval(batchIntervalRef.current);
        batchIntervalRef.current = null;
      }
      if (batchInitialTimeoutRef.current) {
        clearTimeout(batchInitialTimeoutRef.current);
        batchInitialTimeoutRef.current = null;
      }
    }
  }, [
    batchConfig.enabled,
    batchConfig.intervalMinutes,
    isAuthenticated,
    authToken,
    passwordChanged,
  ]);

  // Fetch Portainer instances separately (independent of container data)
  // This ensures tabs remain visible even while containers are loading
  // Returns the formatted instances for immediate use
  const fetchPortainerInstances = async () => {
    if (!isAuthenticated || !authToken) return [];

    try {
      setPortainerInstancesLoading(true);
      const response = await axios.get(
        `${API_BASE_URL}/api/portainer/instances`
      );
      if (response.data.success && response.data.instances) {
        // Map the instances to match the format expected by the UI
        const formattedInstances = response.data.instances.map((inst) => ({
          name: inst.name,
          url: inst.url,
          id: inst.id,
          display_order: inst.display_order,
          containers: [], // Will be populated when containers load
          upToDate: [], // Will be populated when containers load
        }));
        setPortainerInstancesFromAPI(formattedInstances);
        return formattedInstances;
      }
      return [];
    } catch (err) {
      console.error("Error fetching Portainer instances:", err);
      // Don't set error state here - let containers fetch handle errors
      return [];
    } finally {
      setPortainerInstancesLoading(false);
    }
  };

  // Fetch Portainer instances and avatar on app load
  useEffect(() => {
    if (isAuthenticated && authToken) {
      fetchPortainerInstances();
      fetchAvatar();
      fetchRecentAvatars();
    }
  }, [isAuthenticated, authToken]);

  // Fetch user's avatar from server
  const fetchAvatar = async () => {
    try {
      // Add cache-busting parameter to ensure we get the latest version
      const cacheBustUrl = `/api/avatars?t=${Date.now()}`;
      const response = await axios.get(`${API_BASE_URL}${cacheBustUrl}`, {
        responseType: "blob",
      });
      // Convert blob to object URL
      const avatarUrl = URL.createObjectURL(response.data);
      // Revoke old blob URL if it exists
      if (avatar && avatar.startsWith("blob:")) {
        URL.revokeObjectURL(avatar);
      }
      // Only set state if component is still mounted
      setAvatar(avatarUrl);
    } catch (err) {
      // Avatar not found or error - use default
      // Handle both 404 and 204 (No Content) responses
      if (err.response?.status !== 404 && err.response?.status !== 204) {
        console.error("Error fetching avatar:", err);
      }
      // Revoke old blob URL if it exists
      if (avatar && avatar.startsWith("blob:")) {
        URL.revokeObjectURL(avatar);
      }
      // Only set state if component is still mounted
      setAvatar("/img/default-avatar.jpg");
    }
  };

  // Fetch recent avatars from server
  const fetchRecentAvatars = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/avatars/recent`);
      if (response.data.success) {
        setRecentAvatars(response.data.avatars || []);
      }
    } catch (err) {
      console.error("Error fetching recent avatars:", err);
      setRecentAvatars([]);
    }
  };

  // Close avatar menu when clicking outside
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
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showAvatarMenu]);

  const fetchContainers = async (
    showLoading = true,
    instanceUrl = null,
    portainerOnly = false
  ) => {
    try {
      // Track loading state for specific instance if provided
      if (instanceUrl) {
        setLoadingInstances((prev) => new Set(prev).add(instanceUrl));
      } else {
        // Only show loading if explicitly requested (e.g., on pull) or if we have no data
        if (showLoading && containers.length === 0) {
          setLoading(true);
        }
      }

      console.log(
        instanceUrl
          ? `🔄 Fetching containers for instance ${instanceUrl} from Portainer...`
          : portainerOnly
          ? "🔄 Fetching containers from Portainer (no Docker Hub checks)..."
          : "🔄 Fetching containers from API (will use cached data if available, or fetch from Portainer if not)..."
      );

      // Backend will automatically fetch from Portainer if no cache exists
      // If instanceUrl is provided or portainerOnly is true, we want fresh data from Portainer (no cache)
      const url =
        instanceUrl || portainerOnly
          ? `${API_BASE_URL}/api/containers?portainerOnly=true`
          : `${API_BASE_URL}/api/containers`;
      const response = await axios.get(url);
      // Handle both grouped and flat response formats
      if (response.data.grouped && response.data.stacks) {
        setContainers(response.data.containers || []); // Keep flat list for filtering
        setStacks(response.data.stacks || []);
        setUnusedImagesCount(response.data.unusedImagesCount || 0);

        // Check if this data includes Docker Hub information (has update checks)
        // If containers have latestDigest, latestTag, etc., Docker Hub was checked
        const hasDockerHubData =
          response.data.containers &&
          response.data.containers.some(
            (container) =>
              container.latestDigest ||
              container.latestTag ||
              container.latestVersion
          );
        if (hasDockerHubData) {
          setDockerHubDataPulled(true);
          localStorage.setItem("dockerHubDataPulled", JSON.stringify(true));
        }

        // Update portainerInstances from API response (includes container counts)
        // CRITICAL: Always preserve all instances from portainerInstancesFromAPI
        // and merge in container data from the response
        if (response.data.portainerInstances) {
          // If we already have instances, merge the container data while preserving all instances
          if (
            portainerInstancesFromAPI &&
            Array.isArray(portainerInstancesFromAPI) &&
            portainerInstancesFromAPI.length > 0
          ) {
            // Start with all existing instances to preserve them
            const existingInstancesMap = new Map();
            portainerInstancesFromAPI.forEach((inst) => {
              existingInstancesMap.set(inst.url, inst);
            });

            // Update existing instances with container data from response
            response.data.portainerInstances.forEach((apiInst) => {
              const existingInst = existingInstancesMap.get(apiInst.url);
              if (existingInst) {
                // Update existing instance with container data
                existingInstancesMap.set(apiInst.url, {
                  ...existingInst,
                  containers: apiInst.containers || [],
                  withUpdates:
                    apiInst.withUpdates || existingInst.withUpdates || [],
                  upToDate: apiInst.upToDate || existingInst.upToDate || [],
                });
              } else {
                // New instance from response (shouldn't happen, but be safe)
                existingInstancesMap.set(apiInst.url, {
                  name: apiInst.name,
                  url: apiInst.url,
                  id: apiInst.id,
                  display_order: apiInst.display_order || 0,
                  containers: apiInst.containers || [],
                  withUpdates: apiInst.withUpdates || [],
                  upToDate: apiInst.upToDate || [],
                });
              }
            });

            // Convert back to array, preserving order from portainerInstancesFromAPI
            const updatedInstances = portainerInstancesFromAPI.map(
              (existingInst) => {
                return (
                  existingInstancesMap.get(existingInst.url) || existingInst
                );
              }
            );

            // Add any new instances from response that weren't in our list
            response.data.portainerInstances.forEach((apiInst) => {
              if (!updatedInstances.find((inst) => inst.url === apiInst.url)) {
                updatedInstances.push({
                  name: apiInst.name,
                  url: apiInst.url,
                  id: apiInst.id,
                  display_order: apiInst.display_order || 0,
                  containers: apiInst.containers || [],
                  withUpdates: apiInst.withUpdates || [],
                  upToDate: apiInst.upToDate || [],
                });
              }
            });

            setPortainerInstancesFromAPI(updatedInstances);
          } else {
            // First time loading, use API response directly
            setPortainerInstancesFromAPI(response.data.portainerInstances);
          }
        }
      } else {
        // Backward compatibility: treat as flat array
        setContainers(Array.isArray(response.data) ? response.data : []);
        setStacks([]);
        setUnusedImagesCount(0);
      }
      setError(null);
      setDataFetched(true);

      // Fetch unused images (this is fast, doesn't need cache check)
      await fetchUnusedImages();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to fetch containers");
      console.error("Error fetching containers:", err);
    } finally {
      setLoading(false);
      // Clear loading state for specific instance if provided
      if (instanceUrl) {
        setLoadingInstances((prev) => {
          const next = new Set(prev);
          next.delete(instanceUrl);
          return next;
        });
      }
    }
  };

  const fetchUnusedImages = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/images/unused`);
      setUnusedImages(response.data.unusedImages || []);
    } catch (err) {
      console.error("Error fetching unused images:", err);
    }
  };

  const handleClear = async () => {
    if (
      !window.confirm(
        "Are you sure you want to clear all cached data? This will remove all container information until you pull again."
      )
    ) {
      return;
    }

    try {
      setClearing(true);
      setError(null);
      console.log("🗑️ Clearing all cached data...");

      const response = await axios.delete(
        `${API_BASE_URL}/api/containers/cache`
      );

      if (response.data && response.data.success) {
        // Clear container data, but keep Portainer instances (they're in the database)
        setContainers([]);
        setStacks([]);
        setUnusedImagesCount(0);
        // DON'T clear portainerInstancesFromAPI - these are stored in DB and should persist
        setUnusedImages([]);
        setSelectedContainers(new Set());
        setSelectedImages(new Set());
        setDockerHubDataPulled(false); // Reset Docker Hub pull status
        localStorage.setItem("dockerHubDataPulled", JSON.stringify(false));
        setDataFetched(false); // Reset so we can fetch fresh data
        setError(null);
        console.log("✅ Cache cleared successfully");
        // Immediately fetch from Portainer (but not Docker Hub)
        console.log("🔄 Fetching fresh data from Portainer...");
        try {
          await fetchContainers(true, null, true);
          console.log("✅ Portainer data fetched successfully");
        } catch (fetchError) {
          console.error("❌ Error fetching Portainer data:", fetchError);
          setError(
            fetchError.response?.data?.error ||
              "Failed to fetch Portainer data after clearing cache"
          );
        } finally {
          setClearing(false);
        }
      } else {
        // Even if response doesn't have success, clear frontend state
        // The backend cache might have been cleared even if response format is unexpected
        setContainers([]);
        setStacks([]);
        setUnusedImagesCount(0);
        // DON'T clear portainerInstancesFromAPI - these are stored in DB and should persist
        setUnusedImages([]);
        setSelectedContainers(new Set());
        setSelectedImages(new Set());
        setDockerHubDataPulled(false); // Reset Docker Hub pull status
        localStorage.setItem("dockerHubDataPulled", JSON.stringify(false));
        setDataFetched(false); // Reset so we can fetch fresh data
        setError(null);
        console.log("✅ Cache cleared (assuming success)");
        // Immediately fetch from Portainer (but not Docker Hub)
        console.log("🔄 Fetching fresh data from Portainer...");
        try {
          await fetchContainers(true, null, true);
          console.log("✅ Portainer data fetched successfully");
        } catch (fetchError) {
          console.error("❌ Error fetching Portainer data:", fetchError);
          setError(
            fetchError.response?.data?.error ||
              "Failed to fetch Portainer data after clearing cache"
          );
        } finally {
          setClearing(false);
        }
      }
    } catch (err) {
      // If we get a 404, the route might not exist, but we can still clear frontend state
      if (err.response && err.response.status === 404) {
        console.warn(
          "⚠️ Clear cache endpoint not found (404), clearing frontend state anyway"
        );
        setContainers([]);
        setStacks([]);
        setUnusedImagesCount(0);
        // DON'T clear portainerInstancesFromAPI - these are stored in DB and should persist
        setUnusedImages([]);
        setSelectedContainers(new Set());
        setSelectedImages(new Set());
        setDockerHubDataPulled(false); // Reset Docker Hub pull status
        localStorage.setItem("dockerHubDataPulled", JSON.stringify(false));
        setDataFetched(false); // Reset so we can fetch fresh data
        setError(null);
        // Try to clear cache via alternative method (direct database call would require backend change)
        // For now, just clear frontend and show message
        console.log(
          "✅ Frontend state cleared. Backend cache may need manual clearing."
        );
        // Immediately fetch from Portainer (but not Docker Hub)
        console.log("🔄 Fetching fresh data from Portainer...");
        try {
          await fetchContainers(true, null, true);
          console.log("✅ Portainer data fetched successfully");
        } catch (fetchError) {
          console.error("❌ Error fetching Portainer data:", fetchError);
          setError(
            fetchError.response?.data?.error ||
              "Failed to fetch Portainer data after clearing cache"
          );
        } finally {
          setClearing(false);
        }
      } else {
        const errorMessage =
          err.response?.data?.error ||
          err.response?.data?.message ||
          err.message ||
          "Failed to clear cache";
        setError(errorMessage);
        console.error("Error clearing cache:", err);
        setClearing(false);
      }
    }
  };

  const handlePull = async () => {
    try {
      setPulling(true);
      setError(null); // Clear any previous errors
      // Don't set loading to true - show existing data while pulling
      console.log("🔄 Pulling fresh data from Docker Hub...");

      // Start the pull operation (don't await yet - let it run in background)
      const pullPromise = axios.post(
        `${API_BASE_URL}/api/containers/pull`,
        {},
        {
          timeout: 300000, // 5 minute timeout for large pulls
        }
      );

      // While pulling, fetch any existing cached data to show immediately
      // This allows the summary page to display while new data is being fetched
      try {
        const cachedResponse = await axios.get(
          `${API_BASE_URL}/api/containers`
        );
        if (cachedResponse.data.grouped && cachedResponse.data.stacks) {
          setContainers(cachedResponse.data.containers || []);
          setStacks(cachedResponse.data.stacks || []);
          setUnusedImagesCount(cachedResponse.data.unusedImagesCount || 0);

          if (cachedResponse.data.portainerInstances) {
            setPortainerInstancesFromAPI(
              cachedResponse.data.portainerInstances
            );
          }
          setDataFetched(true);
        }
      } catch (cacheErr) {
        // If no cached data exists, that's okay - we'll show empty state
        console.log("No cached data available yet");
      }

      // Now wait for the pull to complete
      const response = await pullPromise;

      // Check if response has success flag
      if (response.data.success === false) {
        throw new Error(
          response.data.error ||
            response.data.message ||
            "Failed to pull container data"
        );
      }

      // Update state with fresh data
      if (response.data.grouped && response.data.stacks) {
        setContainers(response.data.containers || []);
        setStacks(response.data.stacks || []);
        setUnusedImagesCount(response.data.unusedImagesCount || 0);

        if (response.data.portainerInstances) {
          setPortainerInstancesFromAPI(response.data.portainerInstances);
        }

        // Mark that Docker Hub data has been pulled
        setDockerHubDataPulled(true);
        localStorage.setItem("dockerHubDataPulled", JSON.stringify(true));
      } else {
        // Backward compatibility: treat as flat array
        setContainers(Array.isArray(response.data) ? response.data : []);
        setStacks([]);
        setUnusedImagesCount(0);
      }

      setError(null);
      setDataFetched(true);

      // Fetch unused images
      await fetchUnusedImages();
    } catch (err) {
      // Handle rate limit errors specially
      if (
        err.response?.status === 429 ||
        err.response?.data?.rateLimitExceeded
      ) {
        const rateLimitMessage =
          err.response?.data?.message ||
          err.response?.data?.error ||
          "Docker Hub rate limit exceeded. Please wait a few minutes before trying again, or configure Docker Hub credentials in Settings for higher rate limits.";
        setError(rateLimitMessage);
        console.error("❌ Docker Hub rate limit exceeded:", rateLimitMessage);
      } else {
        const errorMessage =
          err.response?.data?.error ||
          err.response?.data?.message ||
          err.message ||
          "Failed to pull container data";
        setError(errorMessage);
        console.error("Error pulling containers:", err);
        if (process.env.NODE_ENV === "development") {
          console.error("Error details:", {
            message: err.message,
            response: err.response?.data,
            status: err.response?.status,
          });
        }
      }
    } finally {
      setPulling(false);
    }
  };

  const handleReorderTabs = async (fromIndex, toIndex) => {
    // Get current instances from API to ensure we have IDs
    try {
      const instancesResponse = await axios.get(
        `${API_BASE_URL}/api/portainer/instances`
      );
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

  const handleToggleImageSelect = (imageId) => {
    setSelectedImages((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  };

  const handleSelectAllImages = () => {
    const allSelected = unusedImages.every((img) => selectedImages.has(img.id));
    if (allSelected) {
      setSelectedImages(new Set());
    } else {
      setSelectedImages(new Set(unusedImages.map((img) => img.id)));
    }
  };

  const handleDeleteImage = async (image) => {
    if (
      !window.confirm(
        `Delete image ${
          image.repoTags?.[0] || image.id
        }? This action cannot be undone.`
      )
    ) {
      return;
    }

    try {
      setDeletingImages(true);
      const imagesToDelete = [image];

      // Deduplicate by image ID + portainerUrl + endpointId to avoid deleting the same image twice
      const uniqueImages = [];
      const seenKeys = new Set();
      for (const img of imagesToDelete) {
        const key = `${img.id}-${img.portainerUrl}-${img.endpointId}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueImages.push(img);
        }
      }

      console.log(
        `Selected ${selectedImages.size} images, sending ${uniqueImages.length} unique images to delete`
      );

      const response = await axios.post(`${API_BASE_URL}/api/images/delete`, {
        images: uniqueImages.map((img) => ({
          id: img.id,
          portainerUrl: img.portainerUrl,
          endpointId: img.endpointId,
        })),
      });

      if (response.data.success) {
        const deletedCount = response.data.deleted || 0;
        // Remove the deleted image from the list immediately
        setUnusedImages((prev) => prev.filter((img) => img.id !== image.id));
        setSelectedImages((prev) => {
          const next = new Set(prev);
          next.delete(image.id);
          return next;
        });
        // Refresh in background
        await fetchContainers();
      } else {
        alert(`Failed to delete image. Check console for details.`);
        console.error("Delete errors:", response.data.errors);
      }
    } catch (err) {
      alert(
        `Failed to delete image: ${err.response?.data?.error || err.message}`
      );
      console.error("Error deleting image:", err);
    } finally {
      setDeletingImages(false);
    }
  };

  const handleDeleteImages = async () => {
    if (selectedImages.size === 0) {
      alert("Please select at least one image to delete");
      return;
    }

    if (
      !window.confirm(
        `Delete ${selectedImages.size} selected image(s)? This action cannot be undone.`
      )
    ) {
      return;
    }

    try {
      setDeletingImages(true);
      const imagesToDelete = unusedImages.filter((img) =>
        selectedImages.has(img.id)
      );

      // Deduplicate by image ID + portainerUrl + endpointId to avoid deleting the same image twice
      const uniqueImages = [];
      const seenKeys = new Set();
      for (const img of imagesToDelete) {
        const key = `${img.id}-${img.portainerUrl}-${img.endpointId}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueImages.push(img);
        }
      }

      console.log(
        `Selected ${selectedImages.size} images, sending ${uniqueImages.length} unique images to delete`
      );

      const response = await axios.post(`${API_BASE_URL}/api/images/delete`, {
        images: uniqueImages.map((img) => ({
          id: img.id,
          portainerUrl: img.portainerUrl,
          endpointId: img.endpointId,
        })),
      });

      if (response.data.success) {
        const deletedCount = response.data.deleted || 0;
        alert(`Successfully deleted ${deletedCount} image(s)`);

        // Refresh containers and unused images
        await fetchContainers();
        setSelectedImages(new Set());
      } else {
        alert(`Failed to delete some images. Check console for details.`);
        console.error("Delete errors:", response.data.errors);
      }
    } catch (err) {
      alert(
        `Failed to delete images: ${err.response?.data?.error || err.message}`
      );
      console.error("Error deleting images:", err);
    } finally {
      setDeletingImages(false);
    }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const handleUpgrade = async (container) => {
    try {
      setUpgrading({ ...upgrading, [container.id]: true });
      const response = await axios.post(
        `${API_BASE_URL}/api/containers/${container.id}/upgrade`,
        {
          endpointId: container.endpointId,
          imageName: container.image,
          portainerUrl: container.portainerUrl,
        }
      );

      if (response.data.success) {
        // Immediately remove container from display (it no longer has updates)
        setContainers((prevContainers) =>
          prevContainers.filter((c) => c.id !== container.id)
        );
        // Remove from selection if it was selected
        setSelectedContainers((prev) => {
          const next = new Set(prev);
          next.delete(container.id);
          return next;
        });
        const oldImage = response.data.oldImage || container.image;
        const newImage = response.data.newImage || container.image;
        alert(
          `Container ${container.name} upgraded successfully!\n` +
            `From: ${oldImage}\n` +
            `To: ${newImage}`
        );
        // Refresh containers in background to update cache
        fetchContainers();
      }
    } catch (err) {
      alert(
        `Failed to upgrade ${container.name}: ${
          err.response?.data?.error || err.message
        }`
      );
      console.error("Error upgrading container:", err);
    } finally {
      setUpgrading({ ...upgrading, [container.id]: false });
    }
  };

  const handleToggleSelect = (containerId) => {
    setSelectedContainers((prev) => {
      const next = new Set(prev);
      if (next.has(containerId)) {
        next.delete(containerId);
      } else {
        next.add(containerId);
      }
      return next;
    });
  };

  const handleSelectAll = (containersToSelect) => {
    // Filter out Portainer containers
    const selectableContainers = containersToSelect.filter(
      (c) => !isPortainerContainer(c)
    );
    const allSelected = selectableContainers.every((c) =>
      selectedContainers.has(c.id)
    );
    if (allSelected) {
      // Deselect all
      setSelectedContainers(new Set());
    } else {
      // Select all (excluding Portainer containers)
      setSelectedContainers(new Set(selectableContainers.map((c) => c.id)));
    }
  };

  const handleToggleStackSelect = (e, containersInStack) => {
    e.stopPropagation(); // Prevent stack collapse
    // Filter out Portainer containers and only containers with updates
    const selectableContainers = containersInStack.filter(
      (c) => !isPortainerContainer(c) && c.hasUpdate
    );
    if (selectableContainers.length === 0) return;

    const allSelected = selectableContainers.every((c) =>
      selectedContainers.has(c.id)
    );

    setSelectedContainers((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        // Deselect all
        selectableContainers.forEach((c) => next.delete(c.id));
      } else {
        // Select all
        selectableContainers.forEach((c) => next.add(c.id));
      }
      return next;
    });
  };

  const handleBatchUpgrade = async () => {
    if (selectedContainers.size === 0) {
      alert("Please select at least one container to upgrade");
      return;
    }

    const containersToUpgrade = containers.filter((c) =>
      selectedContainers.has(c.id)
    );

    if (
      !window.confirm(
        `Upgrade ${containersToUpgrade.length} selected container(s)?`
      )
    ) {
      return;
    }

    // Mark all selected containers as upgrading
    const upgradingState = {};
    containersToUpgrade.forEach((c) => {
      upgradingState[c.id] = true;
    });
    setUpgrading((prev) => ({ ...prev, ...upgradingState }));

    try {
      setBatchUpgrading(true);

      const response = await axios.post(
        `${API_BASE_URL}/api/containers/batch-upgrade`,
        {
          containers: containersToUpgrade.map((c) => ({
            containerId: c.id,
            endpointId: c.endpointId,
            imageName: c.image,
            containerName: c.name,
            portainerUrl: c.portainerUrl,
          })),
        }
      );

      // Immediately remove successfully upgraded containers from display
      const successfulIds = new Set(
        response.data.results?.map((r) => r.containerId) || []
      );
      setContainers((prevContainers) =>
        prevContainers.filter((c) => !successfulIds.has(c.id))
      );
      // Remove successfully upgraded containers from selection
      setSelectedContainers((prev) => {
        const next = new Set(prev);
        successfulIds.forEach((id) => next.delete(id));
        return next;
      });

      // Show results
      const successCount = response.data.results?.length || 0;
      const errorCount = response.data.errors?.length || 0;

      let message = `Batch upgrade completed!\n`;
      message += `✓ Successfully upgraded: ${successCount}\n`;
      if (errorCount > 0) {
        message += `✗ Failed: ${errorCount}\n\n`;
        message += `Errors:\n`;
        response.data.errors.forEach((err) => {
          message += `- ${err.containerName}: ${err.error}\n`;
        });
      }

      alert(message);

      // Clear selection
      setSelectedContainers(new Set());

      // Refresh containers in background to update cache
      fetchContainers();
    } catch (err) {
      alert(
        `Batch upgrade failed: ${err.response?.data?.error || err.message}`
      );
      console.error("Error in batch upgrade:", err);
    } finally {
      setBatchUpgrading(false);
      // Clear upgrading state for all containers
      const clearedState = {};
      containersToUpgrade.forEach((c) => {
        clearedState[c.id] = false;
      });
      setUpgrading((prev) => ({ ...prev, ...clearedState }));
    }
  };

  const containersWithUpdates = containers.filter((c) => c.hasUpdate);
  const containersUpToDate = containers.filter((c) => !c.hasUpdate);

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

  // Check if a container is a Portainer instance
  const isPortainerContainer = (container) => {
    const imageName = container.image?.toLowerCase() || "";
    const containerName = container.name?.toLowerCase() || "";
    return (
      imageName.includes("portainer") || containerName.includes("portainer")
    );
  };

  // Build containersByPortainer map for rendering (always needed)
  // Use URL as the key instead of name, since URL is stable and doesn't change when renamed
  const containersByPortainer = containers.reduce((acc, container) => {
    const portainerUrl = container.portainerUrl || "Unknown";
    const portainerName = container.portainerName || portainerUrl || "Unknown";

    if (!acc[portainerUrl]) {
      acc[portainerUrl] = {
        name: portainerName, // Use current name from container
        url: portainerUrl, // Use URL as stable key
        containers: [],
        withUpdates: [],
        upToDate: [],
      };
    }
    acc[portainerUrl].containers.push(container);
    if (container.hasUpdate) {
      acc[portainerUrl].withUpdates.push(container);
    } else {
      acc[portainerUrl].upToDate.push(container);
    }
    return acc;
  }, {});

  // Use portainerInstances from API response if available (includes IDs and proper ordering)
  // Merge with containersByPortainer to ensure all properties are present
  let portainerInstances = [];

  if (portainerInstancesFromAPI && portainerInstancesFromAPI.length > 0) {
    // Merge API instances with container data to ensure all properties are present
    // Match by URL instead of name, since URL is stable and doesn't change when renamed
    portainerInstances = portainerInstancesFromAPI
      .filter((apiInst) => apiInst != null && apiInst.url) // Filter out invalid entries (check URL instead of name)
      .map((apiInst) => {
        // Match by URL instead of name
        const containerData = containersByPortainer[apiInst.url];
        if (containerData) {
          // Merge API instance data with container data
          // Use the API instance name (which may have been updated) but keep container data
          return {
            ...apiInst,
            name: apiInst.name, // Use the updated name from API
            containers: containerData.containers || apiInst.containers || [],
            withUpdates: containerData.withUpdates || apiInst.withUpdates || [],
            upToDate: containerData.upToDate || apiInst.upToDate || [],
          };
        }
        // If no container data yet, ensure properties are initialized
        return {
          ...apiInst,
          containers: apiInst.containers || [],
          withUpdates: apiInst.withUpdates || [],
          upToDate: apiInst.upToDate || [],
        };
      });
  } else {
    // Fallback: Use containersByPortainer
    portainerInstances = Object.values(containersByPortainer || {});
  }

  // Ensure portainerInstances is always an array
  if (!Array.isArray(portainerInstances)) {
    portainerInstances = [];
  }

  // Safety check: If activeTab is a Portainer instance name but that instance doesn't exist,
  // and we're not currently loading instances, switch back to summary to avoid broken state
  useEffect(() => {
    if (
      activeTab !== "summary" &&
      activeTab !== "settings" &&
      activeTab !== "batch-logs" &&
      !portainerInstancesLoading && // Don't switch during loading
      portainerInstancesFromAPI && // Only check if we have instances loaded
      portainerInstancesFromAPI.length > 0 &&
      !portainerInstances.find((inst) => inst.name === activeTab) &&
      !portainerInstancesFromAPI.find((inst) => inst.name === activeTab)
    ) {
      console.warn(
        `Active tab "${activeTab}" no longer exists, switching to summary`
      );
      setActiveTab("summary");
    }
  }, [
    activeTab,
    portainerInstances,
    portainerInstancesFromAPI,
    portainerInstancesLoading,
  ]);

  // Sort Portainer instances alphabetically by name
  portainerInstances.sort((a, b) => {
    const nameA = (a.name || "").toLowerCase();
    const nameB = (b.name || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });

  // Calculate unused images per Portainer instance
  // Match by URL instead of name for stability
  const unusedImagesByPortainer = unusedImages.reduce((acc, img) => {
    const portainerUrl = img.portainerUrl || "Unknown";
    acc[portainerUrl] = (acc[portainerUrl] || 0) + 1;
    return acc;
  }, {});

  // Calculate summary statistics
  const summaryStats = {
    totalPortainers: (portainerInstances || []).length,
    totalContainers: containers.length,
    containersWithUpdates: containersWithUpdates.length,
    containersUpToDate: containersUpToDate.length,
    unusedImages: unusedImagesCount,
    portainerStats: (portainerInstances || [])
      .filter((p) => p != null) // Filter out any null/undefined entries
      .map((p) => ({
        name: p.name || "Unknown",
        url: p.url || "",
        total: (p.containers || []).length,
        withUpdates: (p.withUpdates || []).length,
        upToDate: (p.upToDate || []).length,
        unusedImages: unusedImagesByPortainer[p.url] || 0, // Match by URL instead of name
      })),
  };

  // Render a stack group
  const renderStackGroup = (stack, containersInStack, showUpdates) => {
    const stackContainersWithUpdates = containersInStack.filter(
      (c) => c.hasUpdate
    );
    const stackContainersUpToDate = containersInStack.filter(
      (c) => !c.hasUpdate
    );

    // If showing updates section, only show stacks with updates
    if (showUpdates && stackContainersWithUpdates.length === 0) {
      return null;
    }

    // If showing up-to-date section, only show stacks with up-to-date containers
    if (!showUpdates && stackContainersUpToDate.length === 0) {
      return null;
    }

    const stackKey = `${stack.stackName}-${
      showUpdates ? "updates" : "current"
    }`;
    const isCollapsed = collapsedStacks.has(stackKey);
    const displayName =
      stack.stackName === "Standalone"
        ? "Standalone Containers"
        : `Stack: ${stack.stackName}`;

    return (
      <div key={stackKey} className="stack-group">
        <div className="stack-header" onClick={() => toggleStack(stackKey)}>
          <div className="stack-header-left">
            <button className="stack-toggle" aria-label="Toggle stack">
              {isCollapsed ? "▶" : "▼"}
            </button>
            <h3 className="stack-name">{displayName}</h3>
          </div>
          {!showUpdates && (
            <span className="stack-count">
              <span>
                {stackContainersUpToDate.length} container
                {stackContainersUpToDate.length !== 1 ? "s" : ""}
              </span>
            </span>
          )}
        </div>
        {!isCollapsed && (
          <>
            {showUpdates && stackContainersWithUpdates.length > 0 && (
              <div className="containers-grid">
                {stackContainersWithUpdates.map((container) => {
                  const isPortainer = isPortainerContainer(container);
                  return (
                    <div
                      key={container.id}
                      className={`container-card update-available ${
                        isPortainer ? "portainer-disabled" : ""
                      }`}
                      title={
                        isPortainer
                          ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                          : ""
                      }
                    >
                      <div
                        className="card-header"
                        title={
                          isPortainer
                            ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                            : ""
                        }
                      >
                        <h3>{container.name}</h3>
                        {container.hasUpdate && (
                          <label className="container-checkbox">
                            <input
                              type="checkbox"
                              checked={selectedContainers.has(container.id)}
                              onChange={() => handleToggleSelect(container.id)}
                              disabled={
                                upgrading[container.id] ||
                                isPortainerContainer(container)
                              }
                              title={
                                isPortainer
                                  ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                                  : ""
                              }
                            />
                          </label>
                        )}
                      </div>
                      <div
                        className="card-body"
                        title={
                          isPortainer
                            ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                            : ""
                        }
                      >
                        {container.portainerName && (
                          <p className="portainer-info">
                            <strong>Portainer:</strong>{" "}
                            <span className="portainer-badge">
                              {container.portainerName}
                            </span>
                          </p>
                        )}
                        <p className="image-info">
                          <strong>Image:</strong> {container.image}
                        </p>
                        <p className="status-info">
                          <strong>Status:</strong> {container.status}
                        </p>
                        <p className="tag-info">
                          <strong>Current:</strong>{" "}
                          <span className="version-badge current">
                            {container.currentDigest ? (
                              <a
                                href={
                                  container.currentTag ||
                                  container.currentVersion
                                    ? getDockerHubUrl(
                                        container.image,
                                        container.currentTag ||
                                          container.currentVersion
                                      )
                                    : getDockerHubTagsUrl(container.image)
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="digest-link"
                                title={
                                  container.currentTag ||
                                  container.currentVersion
                                    ? "View layer on Docker Hub"
                                    : "View tags on Docker Hub"
                                }
                              >
                                sha256:{container.currentDigest}
                              </a>
                            ) : (
                              container.currentVersion ||
                              container.currentTag ||
                              "latest"
                            )}
                          </span>
                        </p>
                        <p className="tag-info">
                          <strong>Latest:</strong>{" "}
                          <span className="version-badge new">
                            {container.latestDigest ? (
                              <a
                                href={getDockerHubUrl(
                                  container.image,
                                  container.latestTag || container.newVersion
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="digest-link"
                                title="View layer on Docker Hub"
                              >
                                sha256:{container.latestDigest}
                              </a>
                            ) : (
                              container.newVersion ||
                              container.latestTag ||
                              "latest"
                            )}
                          </span>
                        </p>
                        {container.latestPublishDate && (
                          <p
                            className="publish-info"
                            style={{
                              fontSize: "0.8rem",
                              color: "var(--text-tertiary)",
                              marginTop: "4px",
                            }}
                          >
                            <strong>Published:</strong>{" "}
                            {formatTimeAgo(container.latestPublishDate)}
                          </p>
                        )}
                      </div>
                      <div
                        className="card-footer"
                        title={
                          isPortainer
                            ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                            : ""
                        }
                      >
                        <button
                          className="upgrade-button"
                          onClick={() => handleUpgrade(container)}
                          disabled={
                            upgrading[container.id] ||
                            isPortainerContainer(container)
                          }
                          title={
                            isPortainerContainer(container)
                              ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                              : ""
                          }
                        >
                          {upgrading[container.id]
                            ? "Upgrading..."
                            : "Upgrade Now"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {!showUpdates && stackContainersUpToDate.length > 0 && (
              <div className="containers-grid">
                {stackContainersUpToDate.map((container) => {
                  const isPortainer = isPortainerContainer(container);
                  return (
                    <div
                      key={container.id}
                      className={`container-card ${
                        isPortainer ? "portainer-disabled" : ""
                      }`}
                      title={
                        isPortainer
                          ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                          : ""
                      }
                    >
                      <div
                        className="card-header"
                        title={
                          isPortainer
                            ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                            : ""
                        }
                      >
                        <h3>{container.name}</h3>
                      </div>
                      <div
                        className="card-body"
                        title={
                          isPortainer
                            ? "Portainer cannot be upgraded automatically. It must be upgraded manually."
                            : ""
                        }
                      >
                        {container.portainerName && (
                          <p className="portainer-info">
                            <strong>Portainer:</strong>{" "}
                            <span className="portainer-badge">
                              {container.portainerName}
                            </span>
                          </p>
                        )}
                        <p className="image-info">
                          <strong>Image:</strong> {container.image}
                        </p>
                        <p className="status-info">
                          <strong>Status:</strong> {container.status}
                        </p>
                        {container.currentDigest && (
                          <p className="tag-info">
                            <strong>Digest:</strong>{" "}
                            <span className="version-badge current">
                              <a
                                href={
                                  container.currentTag ||
                                  container.currentVersion
                                    ? getDockerHubUrl(
                                        container.image,
                                        container.currentTag ||
                                          container.currentVersion
                                      )
                                    : getDockerHubTagsUrl(container.image)
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="digest-link"
                                title={
                                  container.currentTag ||
                                  container.currentVersion
                                    ? "View layer on Docker Hub"
                                    : "View tags on Docker Hub"
                                }
                              >
                                sha256:{container.currentDigest}
                              </a>
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // Render Settings page with tabs
  const renderSettingsPage = () => {
    return (
      <div className="settings-page">
        <div className="summary-header">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
            }}
          >
            <h2 className="settings-header">Settings</h2>
            <button
              onClick={() => setActiveTab("summary")}
              style={{
                padding: "10px 20px",
                fontSize: "1rem",
                fontWeight: "600",
                background: "var(--dodger-blue)",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--dodger-blue-light)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--dodger-blue)";
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              Return Home
            </button>
          </div>
        </div>
        <Settings
          username={username}
          onUsernameUpdate={handleUsernameUpdate}
          onLogout={handleLogout}
          isFirstLogin={!passwordChanged}
          avatar={avatar}
          recentAvatars={recentAvatars}
          onAvatarChange={handleAvatarChange}
          onRecentAvatarsChange={(avatars) => {
            setRecentAvatars(avatars);
            // Refresh recent avatars from server to get latest
            fetchRecentAvatars();
          }}
          onAvatarUploaded={async () => {
            await fetchAvatar();
          }}
          onPasswordUpdateSuccess={handlePasswordUpdateSuccess}
          onPortainerInstancesChange={() => {
            fetchPortainerInstances();
            fetchContainers();
          }}
          activeSection={settingsTab}
          onSectionChange={setSettingsTab}
          showUserInfoAboveTabs={true}
          onBatchConfigUpdate={handleBatchConfigUpdate}
          colorScheme={colorScheme}
          onColorSchemeChange={handleColorSchemeChange}
        />
        <div className="content-tabs">
          <div className="content-tabs-left">
            <button
              className={`content-tab ${
                settingsTab === "general" ? "active" : ""
              }`}
              onClick={() => setSettingsTab("general")}
              disabled={!passwordChanged}
            >
              General
            </button>
            <button
              className={`content-tab ${
                settingsTab === "username" ? "active" : ""
              }`}
              onClick={() => setSettingsTab("username")}
              disabled={!passwordChanged}
            >
              Username
            </button>
            <button
              className={`content-tab ${
                settingsTab === "password" ? "active" : ""
              }`}
              onClick={() => setSettingsTab("password")}
            >
              Password
            </button>
            <button
              className={`content-tab ${
                settingsTab === "avatar" ? "active" : ""
              }`}
              onClick={() => setSettingsTab("avatar")}
              disabled={!passwordChanged}
            >
              Avatar
            </button>
            <button
              className={`content-tab ${
                settingsTab === "portainer" ? "active" : ""
              }`}
              onClick={() => setSettingsTab("portainer")}
              disabled={!passwordChanged}
            >
              Portainer Instances
            </button>
            <button
              className={`content-tab ${
                settingsTab === "dockerhub" ? "active" : ""
              }`}
              onClick={() => setSettingsTab("dockerhub")}
              disabled={!passwordChanged}
            >
              Docker Hub
            </button>
            <button
              className={`content-tab ${
                settingsTab === "batch" ? "active" : ""
              }`}
              onClick={() => setSettingsTab("batch")}
              disabled={!passwordChanged}
            >
              Batch
            </button>
          </div>
        </div>
        <div className="content-tab-panel">
          <ErrorBoundary>
            <Settings
              username={username}
              onUsernameUpdate={handleUsernameUpdate}
              onLogout={handleLogout}
              isFirstLogin={!passwordChanged}
              avatar={avatar}
              recentAvatars={recentAvatars}
              onAvatarChange={handleAvatarChange}
              onRecentAvatarsChange={(avatars) => {
                console.log(
                  "onRecentAvatarsChange called with:",
                  avatars?.length,
                  "avatars"
                );
                setRecentAvatars(avatars);
                // Refresh recent avatars from server to get latest
                fetchRecentAvatars();
              }}
              onAvatarUploaded={async () => {
                await fetchAvatar();
              }}
              onPasswordUpdateSuccess={handlePasswordUpdateSuccess}
              onPortainerInstancesChange={() => {
                fetchPortainerInstances();
                fetchContainers();
              }}
              activeSection={settingsTab}
              onSectionChange={setSettingsTab}
              showUserInfoAboveTabs={false}
              onEditInstance={(instance) => {
                setEditingPortainerInstance(instance);
                setShowAddPortainerModal(true);
              }}
              refreshInstances={
                editingPortainerInstance === null
                  ? fetchPortainerInstances
                  : null
              }
              onBatchConfigUpdate={handleBatchConfigUpdate}
              colorScheme={colorScheme}
              onColorSchemeChange={handleColorSchemeChange}
            />
          </ErrorBoundary>
        </div>
      </div>
    );
  };

  // Render summary page
  const renderSummary = () => {
    return (
      <div className="summary-page">
        <div className="summary-header">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
            }}
          >
            <h2>Summary Dashboard</h2>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <button
                className="pull-button"
                onClick={handlePull}
                disabled={pulling || loading || clearing}
                style={{
                  padding: "10px 20px",
                  fontSize: "1rem",
                  fontWeight: "600",
                  background: pulling
                    ? "var(--bg-secondary)"
                    : "var(--dodger-blue)",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor:
                    pulling || loading || clearing ? "not-allowed" : "pointer",
                  opacity: pulling || loading || clearing ? 0.6 : 1,
                  transition: "all 0.2s",
                }}
              >
                {pulling ? "Pulling..." : "Pull from Docker Hub"}
              </button>
              <button
                className="clear-button"
                onClick={handleClear}
                disabled={clearing || pulling || loading}
                style={{
                  padding: "10px 20px",
                  fontSize: "1rem",
                  fontWeight: "600",
                  background: clearing
                    ? "var(--bg-secondary)"
                    : "var(--dodger-red)",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor:
                    clearing || pulling || loading ? "not-allowed" : "pointer",
                  opacity: clearing || pulling || loading ? 0.6 : 1,
                  transition: "all 0.2s",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: "44px",
                  lineHeight: "1.5",
                }}
                title="Clear all cached data"
                aria-label="Clear cache"
              >
                {clearing ? (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ animation: "spin 1s linear infinite" }}
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
        <div className="summary-stats">
          <div className="stat-card">
            <div className="stat-value">{summaryStats.totalPortainers}</div>
            <div className="stat-label">Portainer Instances</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{summaryStats.totalContainers}</div>
            <div className="stat-label">Total Containers</div>
          </div>
          <div className="stat-card update-available">
            <div className="stat-value">
              {summaryStats.containersWithUpdates}
            </div>
            <div className="stat-label">Updates Available</div>
          </div>
          <div className="stat-card current">
            <div className="stat-value">{summaryStats.containersUpToDate}</div>
            <div className="stat-label">Up to Date</div>
          </div>
          <div className="stat-card unused-images">
            <div className="stat-value">{summaryStats.unusedImages}</div>
            <div className="stat-label">Unused Images</div>
          </div>
        </div>

        <div className="portainer-instances-list">
          <h3>Portainer Instances</h3>
          <div className="instances-grid">
            {summaryStats.portainerStats.map((stat) => (
              <div
                key={stat.name}
                className="instance-card"
                onClick={() => setActiveTab(stat.name)}
              >
                <div className="instance-header">
                  <h4>{stat.name}</h4>
                </div>
                <div className="instance-stats">
                  <div className="instance-stat">
                    <span className="stat-number">{stat.total}</span>
                    <span className="stat-text">Total</span>
                  </div>
                  <div className="instance-stat">
                    <span className="stat-number update">
                      {stat.withUpdates}
                    </span>
                    <span className="stat-text">Updates</span>
                  </div>
                  <div className="instance-stat">
                    <span className="stat-number current">{stat.upToDate}</span>
                    <span className="stat-text">Current</span>
                  </div>
                  <div className="instance-stat">
                    <span className="stat-number">{stat.unusedImages}</span>
                    <span className="stat-text">Unused</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // Render containers for a specific Portainer instance
  const renderPortainerTab = (portainerName) => {
    // Find the instance info first to get the URL
    // Check both portainerInstances (merged with container data) and portainerInstancesFromAPI (raw from API)
    let instanceInfo = portainerInstances.find(
      (inst) => inst.name === portainerName
    );

    // If not found in merged list, check the API list directly (for newly added instances)
    if (
      !instanceInfo &&
      portainerInstancesFromAPI &&
      portainerInstancesFromAPI.length > 0
    ) {
      instanceInfo = portainerInstancesFromAPI.find(
        (inst) => inst.name === portainerName
      );
    }

    // If still no instance info found, show loading state (instance might be loading)
    if (!instanceInfo) {
      return (
        <div className="portainer-tab-content">
          <div className="portainer-instance-header">
            <h2>{portainerName}</h2>
            <div className="instance-loading-indicator">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ animation: "spin 1s linear infinite" }}
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <span>Loading instance...</span>
            </div>
          </div>
          <div className="empty-state">
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "16px",
              }}
            >
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  animation: "spin 1s linear infinite",
                  opacity: 0.6,
                }}
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <p>Loading Portainer instance data...</p>
            </div>
          </div>
        </div>
      );
    }

    // Match by URL instead of name for stability
    const portainerUrl = instanceInfo?.url;
    const portainerData = portainerUrl
      ? containersByPortainer[portainerUrl]
      : null;

    // Always render the tab, even if no data yet
    const instanceContainersWithUpdates = portainerData?.withUpdates || [];
    const instanceContainersUpToDate = portainerData?.upToDate || [];
    const instanceContainers = portainerData?.containers || [];
    const isLoading = loadingInstances.has(portainerUrl);

    // Group by stack for this instance
    const instanceStacks = instanceContainers.reduce((acc, container) => {
      const stackName = container.stackName || "Standalone";
      if (!acc[stackName]) {
        acc[stackName] = [];
      }
      acc[stackName].push(container);
      return acc;
    }, {});

    const groupedStacks = Object.keys(instanceStacks).map((stackName) => ({
      stackName: stackName,
      containers: instanceStacks[stackName],
    }));

    groupedStacks.sort((a, b) => {
      if (a.stackName === "Standalone") return 1;
      if (b.stackName === "Standalone") return -1;
      return a.stackName.localeCompare(b.stackName);
    });

    // Filter unused images for this portainer by URL instead of name
    const portainerUnusedImages = unusedImages.filter(
      (img) => img.portainerUrl === portainerUrl
    );

    // Check if we have any data at all
    const hasData =
      instanceContainers.length > 0 || portainerUnusedImages.length > 0;

    return (
      <div className="portainer-tab-content">
        {/* Portainer Instance Header */}
        <div className="portainer-instance-header">
          <h2>{portainerName}</h2>
          {isLoading && (
            <div className="instance-loading-indicator">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ animation: "spin 1s linear infinite" }}
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <span>Loading data...</span>
            </div>
          )}
        </div>

        {/* Content Tabs */}
        <div className="content-tabs">
          <div className="content-tabs-left">
            <button
              className={`content-tab ${
                contentTab === "updates" ? "active" : ""
              }`}
              onClick={() => setContentTab("updates")}
            >
              Updates Available ({instanceContainersWithUpdates.length})
            </button>
            <button
              className={`content-tab ${
                contentTab === "current" ? "active" : ""
              }`}
              onClick={() => setContentTab("current")}
            >
              Current Containers ({instanceContainersUpToDate.length})
            </button>
            <button
              className={`content-tab ${
                contentTab === "unused" ? "active" : ""
              }`}
              onClick={() => setContentTab("unused")}
            >
              Unused Images ({portainerUnusedImages.length})
            </button>
          </div>
          <div className="content-tabs-right">
            {contentTab === "updates" &&
              instanceContainersWithUpdates.length > 0 && (
                <>
                  {selectedContainers.size > 0 && (
                    <button
                      className="batch-upgrade-button"
                      onClick={handleBatchUpgrade}
                      disabled={batchUpgrading}
                    >
                      {batchUpgrading
                        ? `Upgrading ${selectedContainers.size}...`
                        : `Upgrade Selected (${selectedContainers.size})`}
                    </button>
                  )}
                  <label className="select-all-checkbox">
                    <input
                      type="checkbox"
                      checked={
                        instanceContainersWithUpdates.filter(
                          (c) => !isPortainerContainer(c)
                        ).length > 0 &&
                        instanceContainersWithUpdates
                          .filter((c) => !isPortainerContainer(c))
                          .every((c) => selectedContainers.has(c.id))
                      }
                      onChange={() =>
                        handleSelectAll(instanceContainersWithUpdates)
                      }
                    />
                    Select All
                  </label>
                  {instanceInfo && instanceInfo.url && (
                    <button
                      className="portainer-open-button"
                      onClick={() => {
                        window.open(
                          instanceInfo.url,
                          "_blank",
                          "noopener,noreferrer"
                        );
                      }}
                      title={`Open ${portainerName} in Portainer`}
                      aria-label={`Open ${portainerName} Portainer instance`}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      <span>Open in Portainer</span>
                    </button>
                  )}
                </>
              )}
            {contentTab === "current" && instanceInfo && instanceInfo.url && (
              <button
                className="portainer-open-button"
                onClick={() => {
                  window.open(
                    instanceInfo.url,
                    "_blank",
                    "noopener,noreferrer"
                  );
                }}
                title={`Open ${portainerName} in Portainer`}
                aria-label={`Open ${portainerName} Portainer instance`}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                <span>Open in Portainer</span>
              </button>
            )}
            {contentTab === "unused" && portainerUnusedImages.length > 0 && (
              <>
                {selectedImages.size > 0 && (
                  <button
                    className="delete-images-button"
                    onClick={handleDeleteImages}
                    disabled={deletingImages}
                  >
                    {deletingImages
                      ? `Deleting ${selectedImages.size}...`
                      : `Delete Selected (${selectedImages.size})`}
                  </button>
                )}
                <label className="select-all-checkbox">
                  <input
                    type="checkbox"
                    checked={
                      portainerUnusedImages.length > 0 &&
                      portainerUnusedImages.every((img) =>
                        selectedImages.has(img.id)
                      )
                    }
                    onChange={() => {
                      const allSelected = portainerUnusedImages.every((img) =>
                        selectedImages.has(img.id)
                      );
                      if (allSelected) {
                        const newSet = new Set(selectedImages);
                        portainerUnusedImages.forEach((img) =>
                          newSet.delete(img.id)
                        );
                        setSelectedImages(newSet);
                      } else {
                        const newSet = new Set(selectedImages);
                        portainerUnusedImages.forEach((img) =>
                          newSet.add(img.id)
                        );
                        setSelectedImages(newSet);
                      }
                    }}
                  />
                  Select All
                </label>
                {instanceInfo && instanceInfo.url && (
                  <button
                    className="portainer-open-button"
                    onClick={() => {
                      window.open(
                        instanceInfo.url,
                        "_blank",
                        "noopener,noreferrer"
                      );
                    }}
                    title={`Open ${portainerName} in Portainer`}
                    aria-label={`Open ${portainerName} Portainer instance`}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    <span>Open in Portainer</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Updates Tab */}
        {contentTab === "updates" && (
          <div className="content-tab-panel">
            {isLoading && !hasData ? (
              <div className="empty-state">
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "16px",
                  }}
                >
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      animation: "spin 1s linear infinite",
                      opacity: 0.6,
                    }}
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  <p>Loading container data from Portainer...</p>
                </div>
              </div>
            ) : instanceContainersWithUpdates.length > 0 ? (
              <>
                {groupedStacks.map((stack) =>
                  renderStackGroup(stack, stack.containers, true)
                )}
              </>
            ) : (
              <div className="empty-state">
                <p>
                  {dockerHubDataPulled
                    ? "No containers with updates available."
                    : hasData
                    ? "No containers with updates available. Pull from Docker Hub to check for available upgrades."
                    : "Pull from Docker Hub to check for available upgrades."}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Current Containers Tab */}
        {contentTab === "current" && (
          <div className="content-tab-panel">
            {isLoading && !hasData ? (
              <div className="empty-state">
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "16px",
                  }}
                >
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      animation: "spin 1s linear infinite",
                      opacity: 0.6,
                    }}
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  <p>Loading container data from Portainer...</p>
                </div>
              </div>
            ) : instanceContainersUpToDate.length > 0 ? (
              <>
                {groupedStacks.map((stack) =>
                  renderStackGroup(stack, stack.containers, false)
                )}
              </>
            ) : (
              <div className="empty-state">
                <p>
                  {hasData
                    ? "No up-to-date containers found."
                    : "No containers found. Data will appear once fetched from Portainer."}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Unused Images Tab */}
        {contentTab === "unused" && (
          <div className="content-tab-panel">
            {isLoading && !hasData ? (
              <div className="empty-state">
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "16px",
                  }}
                >
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      animation: "spin 1s linear infinite",
                      opacity: 0.6,
                    }}
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  <p>Loading image data from Portainer...</p>
                </div>
              </div>
            ) : portainerUnusedImages.length > 0 ? (
              <>
                <div className="section-header">
                  <div>
                    <p className="unused-images-total-size">
                      Total Size:{" "}
                      <strong>
                        {formatBytes(
                          portainerUnusedImages.reduce(
                            (sum, img) => sum + (img.size || 0),
                            0
                          )
                        )}
                      </strong>
                    </p>
                  </div>
                </div>
                <div className="unused-images-grid">
                  {portainerUnusedImages.map((image) => (
                    <div key={image.id} className="unused-image-card">
                      <div className="image-card-header">
                        <div className="image-info">
                          <div className="image-tags-header">
                            <strong>Image Tags:</strong>
                          </div>
                          <div className="image-tags">
                            {image.repoTags && image.repoTags.length > 0 ? (
                              image.repoTags.map((tag, idx) => (
                                <span key={idx} className="image-tag-badge">
                                  {tag}
                                </span>
                              ))
                            ) : (
                              <span className="image-tag-badge no-tag">
                                &lt;none&gt;
                              </span>
                            )}
                          </div>
                          <div className="image-meta">
                            <span className="image-size">
                              <strong>Size:</strong> {formatBytes(image.size)}
                            </span>
                            <span className="image-portainer">
                              <strong>Portainer:</strong> {image.portainerName}
                            </span>
                          </div>
                        </div>
                        <label className="image-checkbox">
                          <input
                            type="checkbox"
                            checked={selectedImages.has(image.id)}
                            onChange={() => handleToggleImageSelect(image.id)}
                          />
                        </label>
                      </div>
                      <div className="image-card-footer">
                        <button
                          className="delete-image-button"
                          onClick={() => handleDeleteImage(image)}
                          disabled={deletingImages}
                        >
                          {deletingImages ? "Deleting..." : "Delete Image"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <p>
                  {hasData
                    ? "No unused images found."
                    : "No unused images found. Data will appear once fetched from Portainer."}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Configure axios to include auth token in all requests
  useEffect(() => {
    if (authToken && isAuthenticated) {
      axios.defaults.headers.common["Authorization"] = `Bearer ${authToken}`;
    } else {
      // Clear auth headers when not authenticated
      delete axios.defaults.headers.common["Authorization"];
    }
  }, [authToken, isAuthenticated]);

  // Show login page if not authenticated
  if (!isAuthenticated) {
    // Clear any stale auth data when showing login
    return <Login onLogin={handleLogin} />;
  }

  // If password not changed, force settings page
  if (!passwordChanged) {
    return (
      <div className="App">
        <header className="App-header">
          <div className="header-content">
            <div>
              <h1>🐳 Docked</h1>
              <p>Portainer Container Manager</p>
            </div>
          </div>
        </header>
        <div className="container">
          <Settings
            username={username}
            onUsernameUpdate={handleUsernameUpdate}
            onLogout={handleLogout}
            isFirstLogin={true}
            avatar={avatar}
            recentAvatars={recentAvatars}
            onAvatarChange={handleAvatarChange}
            onRecentAvatarsChange={(avatars) => {
              setRecentAvatars(avatars);
              // Refresh recent avatars from server to get latest
              fetchRecentAvatars();
            }}
            onAvatarUploaded={async () => {
              // Refresh avatar from server after upload to ensure it's up to date
              await fetchAvatar();
            }}
            onPasswordUpdateSuccess={handlePasswordUpdateSuccess}
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

  return (
    <BatchConfigContext.Provider value={batchConfigContextValue}>
      <div className="App">
        <header className="App-header">
          <div className="header-content">
            <div>
              <h1>
                <img
                  src="/img/image.png"
                  alt="Docked"
                  style={{
                    height: "2em",
                    verticalAlign: "middle",
                    marginRight: "8px",
                    display: "inline-block",
                  }}
                />
                <span
                  style={{
                    display: "inline-block",
                    transform: "translateY(3px)",
                  }}
                >
                  Docked
                </span>
              </h1>
            </div>
            <div className="header-actions">
              <div
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <button
                  className="avatar-button"
                  onClick={() => {
                    setShowAvatarMenu(!showAvatarMenu);
                  }}
                  aria-label="User Menu"
                  title="User Menu"
                >
                  <img
                    key={avatar} // Force re-render when avatar changes
                    src={
                      avatar.startsWith("blob:") ||
                      avatar.startsWith("http") ||
                      avatar.startsWith("/img/")
                        ? avatar
                        : `${API_BASE_URL}${avatar}`
                    }
                    alt="User Avatar"
                    className="avatar-image"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      borderRadius: "6px",
                    }}
                    onError={(e) => {
                      // Fallback to default avatar if server avatar fails to load
                      e.target.src = "/img/default-avatar.jpg";
                    }}
                  />
                </button>
                {username && (
                  <div
                    data-username-role
                    onClick={() => {
                      setShowAvatarMenu(!showAvatarMenu);
                    }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      marginLeft: "0px",
                      padding: "6px 12px",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "1.035rem",
                        opacity: 0.95,
                        color: "white",
                        lineHeight: "1.2",
                      }}
                    >
                      {username}
                    </span>
                    <span
                      style={{
                        fontSize: "0.805rem",
                        opacity: 0.8,
                        color: "white",
                        lineHeight: "1.2",
                        marginTop: "2px",
                      }}
                    >
                      {userRole}
                    </span>
                  </div>
                )}
                {showAvatarMenu && (
                  <div className="avatar-menu" style={{ right: 0 }}>
                    <div className="avatar-menu-actions">
                      <button
                        className="avatar-menu-item"
                        onClick={() => {
                          setActiveTab("summary");
                          setShowAvatarMenu(false);
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                          <polyline points="9 22 9 12 15 12 15 22" />
                        </svg>
                        Home
                      </button>
                      <button
                        className="avatar-menu-item"
                        onClick={() => {
                          setActiveTab("settings");
                          setShowAvatarMenu(false);
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        Settings
                      </button>
                      <button
                        className="avatar-menu-item"
                        onClick={() => {
                          console.log("🔄 Navigating to batch-logs page...");
                          console.log("Current activeTab before:", activeTab);
                          setActiveTab("batch-logs");
                          setShowAvatarMenu(false);
                          console.log("✅ Active tab set to batch-logs");
                          // Force a re-render check
                          setTimeout(() => {
                            console.log("ActiveTab after timeout:", activeTab);
                          }, 100);
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                          <polyline points="10 9 9 9 8 9" />
                        </svg>
                        Batch Processing
                      </button>
                      <button
                        className="avatar-menu-item"
                        onClick={() => {
                          // Toggle between light and dark (skip system for quick toggle)
                          const newScheme = darkMode ? "light" : "dark";
                          handleColorSchemeChange(newScheme);
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          {darkMode ? (
                            <>
                              <circle cx="12" cy="12" r="5" />
                              <line x1="12" y1="1" x2="12" y2="3" />
                              <line x1="12" y1="21" x2="12" y2="23" />
                              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                              <line
                                x1="18.36"
                                y1="18.36"
                                x2="19.78"
                                y2="19.78"
                              />
                              <line x1="1" y1="12" x2="3" y2="12" />
                              <line x1="21" y1="12" x2="23" y2="12" />
                              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                            </>
                          ) : (
                            <>
                              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                            </>
                          )}
                        </svg>
                        {darkMode ? "Light Mode" : "Dark Mode"}
                      </button>
                      <div className="avatar-menu-divider"></div>
                      <button
                        className="avatar-menu-item"
                        onClick={() => {
                          handleLogout();
                          setShowAvatarMenu(false);
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                        Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <div
          className="container"
          style={{
            marginTop: pulling ? "70px" : "0",
            transition: "margin-top 0.3s ease-out",
          }}
        >
          {/* Tabs - Only show when not in Settings or Batch Logs */}
          {activeTab !== "settings" && activeTab !== "batch-logs" && (
            <div className="tabs-container">
              <div className="tabs">
                <button
                  className={`tab ${activeTab === "summary" ? "active" : ""}`}
                  onClick={() => setActiveTab("summary")}
                >
                  📊 Summary
                </button>
                {(portainerInstances || [])
                  .filter((inst) => inst != null && inst.name)
                  .map((instance, index) => (
                    <button
                      key={instance.name}
                      className={`tab ${
                        activeTab === instance.name ? "active" : ""
                      } ${draggedTabIndex === index ? "dragging" : ""}`}
                      onClick={() => setActiveTab(instance.name)}
                      draggable
                      onDragStart={(e) => {
                        setDraggedTabIndex(index);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/html", index);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const draggedIndex = parseInt(
                          e.dataTransfer.getData("text/html")
                        );
                        if (draggedIndex !== index) {
                          handleReorderTabs(draggedIndex, index);
                        }
                        setDraggedTabIndex(null);
                      }}
                      onDragEnd={() => {
                        setDraggedTabIndex(null);
                      }}
                    >
                      {instance.name}
                      {instance.withUpdates.length > 0 && (
                        <span className="tab-badge">
                          {instance.withUpdates.length}
                        </span>
                      )}
                    </button>
                  ))}
                <button
                  className={`tab add-instance-tab ${
                    portainerInstances.length > 0
                      ? "add-instance-icon-only"
                      : ""
                  }`}
                  onClick={() => {
                    setEditingPortainerInstance(null);
                    setShowAddPortainerModal(true);
                  }}
                  title="Add Portainer Instance"
                >
                  {portainerInstances.length === 0 ? (
                    <>➕ Add Instance</>
                  ) : (
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Tab Content */}
          <div className="tab-content">
            {activeTab === "settings" ? (
              renderSettingsPage()
            ) : activeTab === "batch-logs" ? (
              <div style={{ width: "100%" }}>
                <ErrorBoundary>
                  <BatchLogs
                    onNavigateHome={() => setActiveTab("summary")}
                    onTriggerBatch={handleBatchPull}
                  />
                </ErrorBoundary>
              </div>
            ) : (
              <>
                {pulling && (
                  <div className="pull-status-banner">
                    <div className="pull-status-content">
                      <div className="pull-spinner">
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                      </div>
                      <div className="pull-status-text">
                        <strong>Pulling fresh data from Docker Hub...</strong>
                        <span>This may take a few moments</span>
                      </div>
                    </div>
                  </div>
                )}
                {loading && containers.length === 0 && !pulling && (
                  <div className="loading">Loading containers...</div>
                )}

                {error && (
                  <div
                    className={`error ${
                      error.includes("rate limit") ||
                      error.includes("Rate limit")
                        ? "rate-limit-error"
                        : ""
                    }`}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "12px",
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <p
                          style={{
                            margin: 0,
                            marginBottom: "8px",
                            fontWeight: 600,
                          }}
                        >
                          {error.includes("rate limit") ||
                          error.includes("Rate limit")
                            ? "⚠️ Docker Hub Rate Limit Exceeded"
                            : "Error"}
                        </p>
                        <p style={{ margin: 0, marginBottom: "12px" }}>
                          {error}
                        </p>
                        {error.includes("rate limit") ||
                        error.includes("Rate limit") ? (
                          <div style={{ marginTop: "12px" }}>
                            <button
                              onClick={() => {
                                setActiveTab("settings");
                                setSettingsTab("dockerhub");
                              }}
                              style={{
                                padding: "8px 16px",
                                background: "var(--dodger-blue)",
                                color: "white",
                                border: "none",
                                borderRadius: "6px",
                                cursor: "pointer",
                                fontSize: "0.9rem",
                                fontWeight: "600",
                                marginRight: "8px",
                              }}
                            >
                              Configure Docker Hub Credentials
                            </button>
                            <button
                              onClick={() => setError(null)}
                              style={{
                                padding: "8px 16px",
                                background: "transparent",
                                color: "var(--text-primary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "6px",
                                cursor: "pointer",
                                fontSize: "0.9rem",
                              }}
                            >
                              Dismiss
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={handlePull}
                            disabled={pulling || loading}
                          >
                            {pulling || loading ? "Retrying..." : "Try Again"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {!loading &&
                  !error &&
                  (!portainerInstances || portainerInstances.length === 0) && (
                    <div
                      className="empty-state"
                      style={{ textAlign: "center", padding: "60px 20px" }}
                    >
                      <h2
                        style={{
                          color: "var(--text-primary)",
                          marginBottom: "15px",
                        }}
                      >
                        No Portainer Instances Configured
                      </h2>
                      <p
                        style={{
                          color: "var(--text-secondary)",
                          marginBottom: "30px",
                          fontSize: "1.1rem",
                        }}
                      >
                        Get started by adding your first Portainer instance.
                      </p>
                      <button
                        className="update-button"
                        onClick={() => {
                          setEditingPortainerInstance(null);
                          setShowAddPortainerModal(true);
                        }}
                        style={{ fontSize: "1.1rem", padding: "14px 28px" }}
                      >
                        ➕ Add Your First Portainer Instance
                      </button>
                    </div>
                  )}

                {!loading &&
                  !error &&
                  portainerInstances &&
                  portainerInstances.length > 0 && (
                    <>
                      {activeTab === "summary" && renderSummary()}
                      {activeTab !== "summary" && renderPortainerTab(activeTab)}
                    </>
                  )}
              </>
            )}
          </div>
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

              // If this is a new instance (not editing), switch to its tab and fetch data
              if (!editingPortainerInstance && newInstanceData) {
                // Find the new instance in the updated list to get the correct name
                // The name might be different if backend used hostname as default
                const newInstance = updatedInstances.find(
                  (inst) =>
                    inst.id === newInstanceData.id ||
                    inst.url === newInstanceData.url
                );

                if (newInstance) {
                  // Use the instance name from the API response (ensures it matches what's in state)
                  const instanceName = newInstance.name;
                  setActiveTab(instanceName);
                  setContentTab("current"); // Start with current containers tab

                  // Trigger background fetch for this specific instance
                  // This fetches from Portainer without Docker Hub checks
                  // Note: This fetches ALL instances, but that's fine - it will include the new one
                  await fetchContainers(false, newInstance.url);
                } else {
                  // Fallback: use the data we have (shouldn't happen, but be safe)
                  const instanceName =
                    newInstanceData.name ||
                    new URL(newInstanceData.url).hostname;
                  setActiveTab(instanceName);
                  setContentTab("current");
                  await fetchContainers(false, newInstanceData.url);
                }
              } else {
                // For edits, just refresh all data
                fetchContainers();
              }

              setEditingPortainerInstance(null);

              // Trigger refresh in Settings component to update the auth method badges
              // If we're on the settings page, trigger a refresh
              if (activeTab === "settings" && settingsTab === "portainer") {
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
    </BatchConfigContext.Provider>
  );
}

// Export the context for use in other components
export { BatchConfigContext };

export default App;

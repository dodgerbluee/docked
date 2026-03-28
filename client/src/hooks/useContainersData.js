import { useState, useCallback, useRef, useEffect } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";
import { updateContainersWithPreservedState } from "../utils/containerStateHelpers";
import { registerCacheClear } from "../utils/cacheRegistry";

// Module-level cache – survives unmount/remount so container-dependent tabs
// (Summary, Containers) render instantly on re-navigation instead of showing
// a loading state while the API is re-fetched.
let cachedContainers = null;
let cachedStacks = null;
let cachedUnusedImages = null;
let cachedUnusedImagesCount = null;
let cachedSourceInstances = null;
let cachedDataFetched = false;

/** Clear module-level cache (call on logout to prevent cross-user data leaks) */
export function clearContainersDataCache() {
  cachedContainers = null;
  cachedStacks = null;
  cachedUnusedImages = null;
  cachedUnusedImagesCount = null;
  cachedSourceInstances = null;
  cachedDataFetched = false;
}
registerCacheClear(clearContainersDataCache);

/**
 * Custom hook for managing container data fetching and state
 * Handles containers, stacks, unused images, and source instances
 */
export const useContainersData = (isAuthenticated, authToken, successfullyUpdatedContainersRef) => {
  const [containers, setContainers] = useState(cachedContainers || []);
  const [stacks, setStacks] = useState(cachedStacks || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [unusedImages, setUnusedImages] = useState(cachedUnusedImages || []);
  const [unusedImagesCount, setUnusedImagesCount] = useState(cachedUnusedImagesCount || 0);
  const [sourceInstancesFromAPI, setSourceInstancesFromAPI] = useState(cachedSourceInstances || []);
  const [sourceInstancesLoading, setSourceInstancesLoading] = useState(false);
  const [loadingInstances, setLoadingInstances] = useState(new Set());
  const [dataFetched, setDataFetched] = useState(cachedDataFetched);
  const [dockerHubDataPulled, setDockerHubDataPulled] = useState(() => {
    const saved = localStorage.getItem("dockerHubDataPulled");
    return saved ? JSON.parse(saved) : false;
  });
  const lastImageDeleteTimeRef = useRef(0);
  const containersCountRef = useRef(0);
  const sourceInstancesRef = useRef([]);
  const dataFetchedRef = useRef(false);

  // Keep module-level cache in sync with state so re-navigation is instant
  useEffect(() => {
    containersCountRef.current = containers.length;
    cachedContainers = containers;
  }, [containers]);

  useEffect(() => {
    sourceInstancesRef.current = sourceInstancesFromAPI;
    cachedSourceInstances = sourceInstancesFromAPI;
  }, [sourceInstancesFromAPI]);

  useEffect(() => {
    dataFetchedRef.current = dataFetched;
    cachedDataFetched = dataFetched;
  }, [dataFetched]);

  useEffect(() => {
    cachedStacks = stacks;
  }, [stacks]);

  useEffect(() => {
    cachedUnusedImages = unusedImages;
  }, [unusedImages]);

  useEffect(() => {
    cachedUnusedImagesCount = unusedImagesCount;
  }, [unusedImagesCount]);

  const fetchUnusedImages = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/images/unused`);
      const images = response.data.unusedImages || [];
      setUnusedImages(images);
      setUnusedImagesCount(images.length);
    } catch (err) {
      console.error("Error fetching unused images:", err);
    }
  }, []);

  const fetchContainers = useCallback(
    async (
      showLoading = true,
      instanceUrl = null,
      portainerOnly = false,
      refreshUpdates = false
    ) => {
      try {
        // Track loading state for specific instance if provided
        if (instanceUrl) {
          setLoadingInstances((prev) => new Set(prev).add(instanceUrl));
        } else {
          // Only show loading if:
          // 1. Explicitly requested (showLoading = true)
          // 2. AND we have no data (containers.length === 0)
          // 3. AND not refreshing (refreshUpdates = false)
          // 4. AND we haven't fetched data before (dataFetched = false)
          // This prevents showing loading screen when we have cached data or after initial load
          if (
            showLoading &&
            containersCountRef.current === 0 &&
            !refreshUpdates &&
            !dataFetchedRef.current
          ) {
            setLoading(true);
          }
        }

        // Fire unused images fetch in parallel with containers fetch
        // (don't await yet — let both requests fly concurrently)
        const unusedImagesPromise = fetchUnusedImages();

        // Backend will automatically fetch from source if no cache exists
        // If instanceUrl is provided or portainerOnly is true, we want fresh data from source (no cache)
        // If refreshUpdates is true, also re-evaluate update status
        // Use new cache service for better experience
        const params = new URLSearchParams();
        params.append("useNewCache", "true"); // Enable new cache service
        if (instanceUrl || portainerOnly) {
          params.append("portainerOnly", "true");
        }
        if (refreshUpdates) {
          params.append("refreshUpdates", "true");
        }
        if (instanceUrl) {
          params.append("portainerUrl", instanceUrl);
        }
        const url = `${API_BASE_URL}/api/containers${params.toString() ? `?${params.toString()}` : ""}`;
        const response = await axios.get(url);

        // Handle both grouped and flat response formats
        if (response.data.grouped && response.data.stacks) {
          // Preserve hasUpdate:false for containers that were successfully updated
          // Use the helper function which computes hasUpdate on-the-fly
          const apiContainers = response.data.containers || [];
          const updatedContainers = updateContainersWithPreservedState(
            apiContainers,
            successfullyUpdatedContainersRef
          );

          if (portainerOnly || instanceUrl) {
            // When refreshing source-only data, merge with existing runner containers
            // so we don't lose runner containers from state
            setContainers((prev) => {
              const runnerContainers = prev.filter((c) => c.source === "runner");
              return [...updatedContainers, ...runnerContainers];
            });
          } else {
            setContainers(updatedContainers);
          }
          setStacks(response.data.stacks || []);
          // Only update unused images count if we haven't just deleted images
          const timeSinceLastDelete = Date.now() - lastImageDeleteTimeRef.current;
          if (timeSinceLastDelete > 2000) {
            setUnusedImagesCount(response.data.unusedImagesCount || 0);
          }

          // Check if this data includes Docker Hub information
          const hasDockerHubData =
            response.data.containers &&
            response.data.containers.some(
              (container) =>
                container.latestDigest || container.latestTag || container.latestVersion
            );
          if (hasDockerHubData) {
            setDockerHubDataPulled(true);
            localStorage.setItem("dockerHubDataPulled", JSON.stringify(true));
          }

          // Update sourceInstances from API response
          // Server returns "sourceInstances"; accept both for backward compatibility
          const apiSourceInstances =
            response.data.sourceInstances || response.data.portainerInstances;
          if (apiSourceInstances) {
            if (portainerOnly || instanceUrl) {
              setSourceInstancesFromAPI(apiSourceInstances);
            } else if (
              sourceInstancesRef.current &&
              Array.isArray(sourceInstancesRef.current) &&
              sourceInstancesRef.current.length > 0
            ) {
              // Merge container data while preserving instances from API
              const existingInstancesMap = new Map();
              sourceInstancesRef.current.forEach((inst) => {
                existingInstancesMap.set(inst.url, inst);
              });

              apiSourceInstances.forEach((apiInst) => {
                const existingInst = existingInstancesMap.get(apiInst.url);
                if (existingInst) {
                  existingInstancesMap.set(apiInst.url, {
                    ...existingInst,
                    containers: apiInst.containers || [],
                    withUpdates: apiInst.withUpdates || existingInst.withUpdates || [],
                    upToDate: apiInst.upToDate || existingInst.upToDate || [],
                  });
                } else {
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

              const responseUrls = new Set(apiSourceInstances.map((inst) => inst.url));
              const updatedInstances = sourceInstancesRef.current
                .filter((inst) => responseUrls.has(inst.url))
                .map((existingInst) => {
                  return existingInstancesMap.get(existingInst.url) || existingInst;
                });

              apiSourceInstances.forEach((apiInst) => {
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

              setSourceInstancesFromAPI(updatedInstances);
            } else {
              setSourceInstancesFromAPI(apiSourceInstances);
            }
          }
        } else {
          // Backward compatibility: treat as flat array
          const apiContainers = Array.isArray(response.data) ? response.data : [];
          const updatedContainers = apiContainers.map((apiContainer) => {
            // Use the helper function which computes hasUpdate on-the-fly
            const updated = updateContainersWithPreservedState(
              [apiContainer],
              successfullyUpdatedContainersRef
            );
            return updated[0] || apiContainer;
          });
          setContainers(updatedContainers);
          setStacks([]);
          setUnusedImagesCount(0);
        }
        setError(null);
        setDataFetched(true);

        // Await the unused images fetch that was started in parallel
        await unusedImagesPromise;
      } catch (err) {
        setError(err.response?.data?.error || "Failed to fetch containers");
        console.error("Error fetching containers:", err);
      } finally {
        setLoading(false);
        if (instanceUrl) {
          setLoadingInstances((prev) => {
            const next = new Set(prev);
            next.delete(instanceUrl);
            return next;
          });
        }
      }
    },
    [fetchUnusedImages, successfullyUpdatedContainersRef]
  );

  const fetchSourceInstances = useCallback(async () => {
    if (!isAuthenticated || !authToken) return [];

    try {
      setSourceInstancesLoading(true);
      const response = await axios.get(`${API_BASE_URL}/api/sources/instances`);
      if (response.data.success && response.data.instances) {
        const formattedInstances = response.data.instances.map((inst) => ({
          name: inst.name,
          url: inst.url,
          id: inst.id,
          display_order: inst.display_order,
          containers: [],
          upToDate: [],
        }));
        setSourceInstancesFromAPI(formattedInstances);
        return formattedInstances;
      }
      return [];
    } catch (err) {
      console.error("Error fetching source instances:", err);
      return [];
    } finally {
      setSourceInstancesLoading(false);
    }
  }, [isAuthenticated, authToken]);

  const updateLastImageDeleteTime = useCallback(() => {
    lastImageDeleteTimeRef.current = Date.now();
  }, []);

  return {
    // State
    containers,
    stacks,
    loading,
    error,
    unusedImages,
    unusedImagesCount,
    sourceInstancesFromAPI,
    sourceInstancesLoading,
    loadingInstances,
    dataFetched,
    dockerHubDataPulled,
    // Setters (for external updates)
    setContainers,
    setStacks,
    setError,
    setLoading,
    setUnusedImages,
    setUnusedImagesCount,
    setSourceInstancesFromAPI,
    setDockerHubDataPulled,
    setDataFetched,
    // Functions
    fetchContainers,
    fetchUnusedImages,
    fetchSourceInstances,
    updateLastImageDeleteTime,
    // Refs (for external access)
    lastImageDeleteTimeRef,
  };
};

import { useState, useCallback, useRef, useEffect } from "react";
import { updateContainersWithPreservedState } from "../utils/containerStateHelpers";
import { registerCacheClear, getSessionGeneration, isSessionStale } from "../utils/cacheRegistry";
import { fetchContainersGraphql } from "../graphql/containers";
import { graphqlClient } from "../graphql/client";
import { UNUSED_IMAGES_QUERY } from "../graphql/queries";

// Module-level cache – survives unmount/remount so container-dependent tabs
// (Summary, Containers) render instantly on re-navigation instead of showing
// a loading state while the API is re-fetched.
let cachedContainers = null;
let cachedStacks = null;
let cachedUnusedImages = null;
let cachedUnusedImagesCount = null;
let cachedDataFetched = false;

/** Clear module-level cache (call on logout to prevent cross-user data leaks) */
export function clearContainersDataCache() {
  cachedContainers = null;
  cachedStacks = null;
  cachedUnusedImages = null;
  cachedUnusedImagesCount = null;
  cachedDataFetched = false;
}
registerCacheClear(clearContainersDataCache);

/**
 * Custom hook for managing container data fetching and state
 * Handles containers, stacks, unused images, and source instances
 */
export const useContainersData = (successfullyUpdatedContainersRef) => {
  const [containers, setContainers] = useState(cachedContainers || []);
  const [stacks, setStacks] = useState(cachedStacks || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [unusedImages, setUnusedImages] = useState(cachedUnusedImages || []);
  const [unusedImagesCount, setUnusedImagesCount] = useState(cachedUnusedImagesCount || 0);
  const [loadingInstances, setLoadingInstances] = useState(new Set());
  const [dataFetched, setDataFetched] = useState(cachedDataFetched);
  const [dockerHubDataPulled, setDockerHubDataPulled] = useState(() => {
    const saved = localStorage.getItem("dockerHubDataPulled");
    return saved ? JSON.parse(saved) : false;
  });
  const lastImageDeleteTimeRef = useRef(0);
  const containersCountRef = useRef(0);
  const dataFetchedRef = useRef(false);

  // Keep module-level cache in sync with state so re-navigation is instant
  useEffect(() => {
    containersCountRef.current = containers.length;
    cachedContainers = containers;
  }, [containers]);

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
      const gen = getSessionGeneration();
      const result = await graphqlClient.query(UNUSED_IMAGES_QUERY).toPromise();
      if (result.error) throw result.error;
      if (isSessionStale(gen)) return; // logout mid-flight: not this session's data
      // Graph runnerId is String; the UI (source filters, delete payloads)
      // uses numeric runner ids like the legacy REST rows did.
      const images = (result.data?.unusedImages || []).map((img) =>
        img.runnerId != null ? { ...img, runnerId: Number(img.runnerId) } : img
      );
      setUnusedImages(images);
      setUnusedImagesCount(images.length);
    } catch (err) {
      console.error("Error fetching unused images:", err);
    }
  }, []);

  const fetchContainers = useCallback(
    async (showLoading = true, instanceUrl = null) => {
      // Captured before the try so the catch/finally below can tell whether
      // they still belong to this session: a failed fetch from a dead session
      // must not replace the new session's error or clear its loading state.
      const gen = getSessionGeneration();
      try {
        // Track loading state for specific instance if provided
        if (instanceUrl) {
          setLoadingInstances((prev) => new Set(prev).add(instanceUrl));
        } else {
          // Only show loading if:
          // 1. Explicitly requested (showLoading = true)
          // 2. AND we have no data (containers.length === 0)
          // 3. AND we haven't fetched data before (dataFetched = false)
          // This prevents showing loading screen when we have cached data or after initial load
          if (showLoading && containersCountRef.current === 0 && !dataFetchedRef.current) {
            setLoading(true);
          }
        }

        // Fire unused images fetch in parallel with containers fetch
        // (don't await yet — let both requests fly concurrently)
        const unusedImagesPromise = fetchUnusedImages();

        // GraphQL containerGroup returns the full set with live runner data
        // merged server-side (replacing stale DB runner rows), so the legacy
        // portainerOnly/instanceUrl scoping params are no longer needed —
        // callers may still pass them and they are ignored.
        const { containers: apiContainers, stacks: apiStacks } = await fetchContainersGraphql();

        // A logout (or user switch) happened mid-flight: this response
        // belongs to the dead session and must not repopulate state —
        // the app-level hook stays mounted across auth changes.
        if (isSessionStale(gen)) return;

        // Preserve hasUpdate:false for containers that were successfully updated
        const updatedContainers = updateContainersWithPreservedState(
          apiContainers,
          successfullyUpdatedContainersRef
        );

        setContainers(updatedContainers);
        setStacks(apiStacks);

        // Check if this data includes registry (Docker Hub) information
        const hasRegistryData = apiContainers.some(
          (container) => container.latestDigest || container.latestTag || container.latestVersion
        );
        if (hasRegistryData) {
          setDockerHubDataPulled(true);
          localStorage.setItem("dockerHubDataPulled", JSON.stringify(true));
        }

        setError(null);
        setDataFetched(true);

        // Await the unused images fetch that was started in parallel
        await unusedImagesPromise;
      } catch (err) {
        if (isSessionStale(gen)) return;
        setError(err?.message || "Failed to fetch containers");
        console.error("Error fetching containers:", err);
      } finally {
        if (!isSessionStale(gen)) {
          setLoading(false);
          if (instanceUrl) {
            setLoadingInstances((prev) => {
              const next = new Set(prev);
              next.delete(instanceUrl);
              return next;
            });
          }
        }
      }
    },
    [fetchUnusedImages, successfullyUpdatedContainersRef]
  );

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
    setDockerHubDataPulled,
    setDataFetched,
    // Functions
    fetchContainers,
    fetchUnusedImages,
    updateLastImageDeleteTime,
    // Refs (for external access)
    lastImageDeleteTimeRef,
  };
};

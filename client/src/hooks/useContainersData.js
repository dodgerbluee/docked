import { useState, useCallback, useRef, useEffect } from "react";
import { updateContainersWithPreservedState } from "../utils/containerStateHelpers";
import { registerCacheClear } from "../utils/cacheRegistry";
import { graphqlClient } from "../graphql/client";
import { SOURCE_INSTANCES_QUERY, UNUSED_IMAGES_QUERY } from "../graphql/queries";
import { fetchContainersGraphql } from "../graphql/containers";

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
      const result = await graphqlClient.query(UNUSED_IMAGES_QUERY).toPromise();
      if (result.error) throw result.error;
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

        // Source instances are managed separately via SOURCE_INSTANCES_QUERY
        // (fetchSourceInstances); per-instance container groupings are derived
        // client-side from the flat list by useSourceInstances.
        setError(null);
        setDataFetched(true);

        // Await the unused images fetch that was started in parallel
        await unusedImagesPromise;
      } catch (err) {
        setError(err?.message || "Failed to fetch containers");
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
      const result = await graphqlClient.query(SOURCE_INSTANCES_QUERY).toPromise();
      if (!result.error && result.data?.sourceInstances) {
        const formattedInstances = result.data.sourceInstances.map((inst) => ({
          name: inst.name,
          url: inst.url,
          id: inst.id,
          display_order: inst.displayOrder,
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

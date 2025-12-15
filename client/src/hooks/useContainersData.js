import { useState, useCallback, useRef } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";
import { updateContainersWithPreservedState } from "../utils/containerStateHelpers";

/**
 * Custom hook for managing container data fetching and state
 * Handles containers, stacks, unused images, and Portainer instances
 */
export const useContainersData = (isAuthenticated, authToken, successfullyUpdatedContainersRef) => {
  const [containers, setContainers] = useState([]);
  const [stacks, setStacks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [unusedImages, setUnusedImages] = useState([]);
  const [unusedImagesCount, setUnusedImagesCount] = useState(0);
  const [portainerInstancesFromAPI, setPortainerInstancesFromAPI] = useState([]);
  const [portainerInstancesLoading, setPortainerInstancesLoading] = useState(false);
  const [loadingInstances, setLoadingInstances] = useState(new Set());
  const [dataFetched, setDataFetched] = useState(false);
  const [dockerHubDataPulled, setDockerHubDataPulled] = useState(() => {
    const saved = localStorage.getItem("dockerHubDataPulled");
    return saved ? JSON.parse(saved) : false;
  });
  const lastImageDeleteTimeRef = useRef(0);

  const fetchUnusedImages = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/images/unused`);
      setUnusedImages(response.data.unusedImages || []);
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
          // Only show loading if explicitly requested (e.g., on pull) or if we have no data
          // When refreshUpdates is true, we're refreshing to detect manual upgrades, so don't show loading
          // to avoid flickering - the data will update quickly
          if (showLoading && containers.length === 0 && !refreshUpdates) {
            setLoading(true);
          }
        }

        console.log(
          instanceUrl
            ? `🔄 Fetching containers for instance ${instanceUrl} from Portainer...`
            : portainerOnly
              ? refreshUpdates
                ? "🔄 Fetching containers from Portainer and re-evaluating update status..."
                : "🔄 Fetching containers from Portainer"
              : "🔄 Fetching containers from API (will use cached data if available, or fetch from Portainer if not)..."
        );

        // Backend will automatically fetch from Portainer if no cache exists
        // If instanceUrl is provided or portainerOnly is true, we want fresh data from Portainer (no cache)
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
          setContainers(updatedContainers);
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

          // Update portainerInstances from API response
          if (response.data.portainerInstances) {
            if (portainerOnly || instanceUrl) {
              setPortainerInstancesFromAPI(response.data.portainerInstances);
            } else if (
              portainerInstancesFromAPI &&
              Array.isArray(portainerInstancesFromAPI) &&
              portainerInstancesFromAPI.length > 0
            ) {
              // Merge container data while preserving instances from API
              const existingInstancesMap = new Map();
              portainerInstancesFromAPI.forEach((inst) => {
                existingInstancesMap.set(inst.url, inst);
              });

              response.data.portainerInstances.forEach((apiInst) => {
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

              const responseUrls = new Set(
                response.data.portainerInstances.map((inst) => inst.url)
              );
              const updatedInstances = portainerInstancesFromAPI
                .filter((inst) => responseUrls.has(inst.url))
                .map((existingInst) => {
                  return existingInstancesMap.get(existingInst.url) || existingInst;
                });

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
              setPortainerInstancesFromAPI(response.data.portainerInstances);
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

        // Fetch unused images
        await fetchUnusedImages();
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
    [
      containers.length,
      portainerInstancesFromAPI,
      fetchUnusedImages,
      successfullyUpdatedContainersRef,
    ]
  );

  const fetchPortainerInstances = useCallback(async () => {
    if (!isAuthenticated || !authToken) return [];

    try {
      setPortainerInstancesLoading(true);
      const response = await axios.get(`${API_BASE_URL}/api/portainer/instances`);
      if (response.data.success && response.data.instances) {
        const formattedInstances = response.data.instances.map((inst) => ({
          name: inst.name,
          url: inst.url,
          id: inst.id,
          display_order: inst.display_order,
          containers: [],
          upToDate: [],
        }));
        setPortainerInstancesFromAPI(formattedInstances);
        return formattedInstances;
      }
      return [];
    } catch (err) {
      console.error("Error fetching Portainer instances:", err);
      return [];
    } finally {
      setPortainerInstancesLoading(false);
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
    portainerInstancesFromAPI,
    portainerInstancesLoading,
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
    setPortainerInstancesFromAPI,
    setDockerHubDataPulled,
    setDataFetched,
    // Functions
    fetchContainers,
    fetchUnusedImages,
    fetchPortainerInstances,
    updateLastImageDeleteTime,
    // Refs (for external access)
    lastImageDeleteTimeRef,
  };
};

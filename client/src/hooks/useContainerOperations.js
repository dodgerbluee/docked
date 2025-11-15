import { useState, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";
import { handleDockerHubError } from "../utils/apiErrorHandler";

/**
 * Custom hook for container operations (upgrade, delete, clear, pull)
 * Handles all container-related actions and state management
 */
export const useContainerOperations = ({
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
  setClearing: setClearingProp,
  setDeletingImages: setDeletingImagesProp,
  successfullyUpdatedContainersRef,
  fetchContainers,
  fetchUnusedImages,
  updateLastImageDeleteTime,
}) => {
  const [upgrading, setUpgrading] = useState({});
  const [batchUpgrading, setBatchUpgrading] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [clearing, setClearing] = useState(false);
  const [deletingImages, setDeletingImages] = useState(false);

  // Use local state if prop setters are not provided
  const setClearingState = setClearingProp || setClearing;
  const setDeletingImagesState = setDeletingImagesProp || setDeletingImages;

  const handleUpgrade = useCallback(
    async (container) => {
      try {
        setUpgrading((prev) => ({ ...prev, [container.id]: true }));
        const response = await axios.post(
          `${API_BASE_URL}/api/containers/${container.id}/upgrade`,
          {
            endpointId: container.endpointId,
            imageName: container.image,
            portainerUrl: container.portainerUrl,
          }
        );

        if (response.data.success) {
          successfullyUpdatedContainersRef.current.add(container.id);

          setContainers((prevContainers) =>
            prevContainers.map((c) => (c.id === container.id ? { ...c, hasUpdate: false } : c))
          );

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

          fetchContainers();
        }
      } catch (err) {
        alert(`Failed to upgrade ${container.name}: ${err.response?.data?.error || err.message}`);
        console.error("Error upgrading container:", err);
      } finally {
        setUpgrading((prev) => ({ ...prev, [container.id]: false }));
      }
    },
    [setContainers, setSelectedContainers, successfullyUpdatedContainersRef, fetchContainers]
  );

  const handleBatchUpgrade = useCallback(
    async (selectedContainers) => {
      if (selectedContainers.size === 0) {
        alert("Please select at least one container to upgrade");
        return;
      }

      const containersToUpgrade = containers.filter((c) => selectedContainers.has(c.id));

      if (!window.confirm(`Upgrade ${containersToUpgrade.length} selected container(s)?`)) {
        return;
      }

      const upgradingState = {};
      containersToUpgrade.forEach((c) => {
        upgradingState[c.id] = true;
      });
      setUpgrading((prev) => ({ ...prev, ...upgradingState }));

      try {
        setBatchUpgrading(true);

        const response = await axios.post(`${API_BASE_URL}/api/containers/batch-upgrade`, {
          containers: containersToUpgrade.map((c) => ({
            containerId: c.id,
            endpointId: c.endpointId,
            imageName: c.image,
            containerName: c.name,
            portainerUrl: c.portainerUrl,
          })),
        });

        const successfulIds = new Set(response.data.results?.map((r) => r.containerId) || []);

        successfulIds.forEach((containerId) => {
          successfullyUpdatedContainersRef.current.add(containerId);
        });

        setContainers((prevContainers) =>
          prevContainers.map((c) => (successfulIds.has(c.id) ? { ...c, hasUpdate: false } : c))
        );

        setSelectedContainers((prev) => {
          const next = new Set(prev);
          successfulIds.forEach((id) => next.delete(id));
          return next;
        });

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
        setSelectedContainers(new Set());
        fetchContainers();
      } catch (err) {
        alert(`Batch upgrade failed: ${err.response?.data?.error || err.message}`);
        console.error("Error in batch upgrade:", err);
      } finally {
        setBatchUpgrading(false);
        const clearedState = {};
        containersToUpgrade.forEach((c) => {
          clearedState[c.id] = false;
        });
        setUpgrading((prev) => ({ ...prev, ...clearedState }));
      }
    },
    [
      containers,
      setContainers,
      setSelectedContainers,
      successfullyUpdatedContainersRef,
      fetchContainers,
    ]
  );

  const handleDeleteImage = useCallback(
    async (image) => {
      try {
        setDeletingImages(true);
        const response = await axios.delete(`${API_BASE_URL}/api/images/${image.id}`, {
          data: {
            portainerUrl: image.portainerUrl,
          },
        });

        if (response.data.success) {
          updateLastImageDeleteTime();
          setUnusedImages((prev) => prev.filter((img) => img.id !== image.id));
          setUnusedImagesCount((prev) => Math.max(0, prev - 1));
          setSelectedImages((prev) => {
            const next = new Set(prev);
            next.delete(image.id);
            return next;
          });
        }
      } catch (err) {
        console.error("Error deleting image:", err);
        alert(`Failed to delete image: ${err.response?.data?.error || err.message}`);
      } finally {
        setDeletingImagesState(false);
      }
    },
    [
      setUnusedImages,
      setUnusedImagesCount,
      setSelectedImages,
      updateLastImageDeleteTime,
      setDeletingImagesState,
    ]
  );

  const handleDeleteImages = useCallback(
    async (selectedImages) => {
      if (selectedImages.size === 0) {
        alert("Please select at least one image to delete");
        return;
      }

      const imagesToDelete = Array.from(selectedImages)
        .map((id) => {
          const image = unusedImages.find((img) => img.id === id);
          return image;
        })
        .filter(Boolean);

      if (
        !window.confirm(
          `Delete ${imagesToDelete.length} selected image(s)? This action cannot be undone.`
        )
      ) {
        return;
      }

      try {
        setDeletingImagesState(true);
        updateLastImageDeleteTime();

        const deletePromises = imagesToDelete.map((image) =>
          axios.delete(`${API_BASE_URL}/api/images/${image.id}`, {
            data: {
              portainerUrl: image.portainerUrl,
            },
          })
        );

        const results = await Promise.allSettled(deletePromises);
        const successful = results.filter((r) => r.status === "fulfilled");
        const failed = results.filter((r) => r.status === "rejected");

        if (successful.length > 0) {
          const deletedIds = new Set(successful.map((r, idx) => imagesToDelete[idx].id));
          setUnusedImages((prev) => prev.filter((img) => !deletedIds.has(img.id)));
          setUnusedImagesCount((prev) => Math.max(0, prev - successful.length));
          setSelectedImages(new Set());
        }

        if (failed.length > 0) {
          alert(`Failed to delete ${failed.length} image(s). Please try again.`);
        }
      } catch (err) {
        console.error("Error deleting images:", err);
      } finally {
        setDeletingImagesState(false);
      }
    },
    [
      unusedImages,
      setUnusedImages,
      setUnusedImagesCount,
      setSelectedImages,
      updateLastImageDeleteTime,
      setDeletingImagesState,
    ]
  );

  const handleClear = useCallback(async () => {
    if (
      !window.confirm(
        "Are you sure you want to clear all cached data? This will remove all container information until you pull again."
      )
    ) {
      return;
    }

    try {
      setClearingState(true);
      setError(null);
      console.log("🗑️ Clearing all cached data...");

      const response = await axios.delete(`${API_BASE_URL}/api/containers/cache`);

      const clearFrontendState = () => {
        setContainers([]);
        setStacks([]);
        setUnusedImagesCount(0);
        setUnusedImages([]);
        setSelectedContainers(new Set());
        setSelectedImages(new Set());
        setDockerHubDataPulled(false);
        localStorage.setItem("dockerHubDataPulled", JSON.stringify(false));
        setDataFetched(false);
        setError(null);
      };

      if (response.data && response.data.success) {
        clearFrontendState();
        console.log("✅ Cache cleared successfully");
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
          setClearingState(false);
        }
      } else {
        clearFrontendState();
        console.log("✅ Cache cleared (assuming success)");
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
          setClearingState(false);
        }
      }
    } catch (err) {
      if (err.response && err.response.status === 404) {
        console.warn("⚠️ Clear cache endpoint not found (404), clearing frontend state anyway");
        setContainers([]);
        setStacks([]);
        setUnusedImagesCount(0);
        setUnusedImages([]);
        setSelectedContainers(new Set());
        setSelectedImages(new Set());
        setDockerHubDataPulled(false);
        localStorage.setItem("dockerHubDataPulled", JSON.stringify(false));
        setDataFetched(false);
        setError(null);
        console.log("✅ Frontend state cleared. Backend cache may need manual clearing.");
      } else {
        console.error("Error clearing cache:", err);
        setError(err.response?.data?.error || err.message || "Failed to clear cache");
      }
    } finally {
      setClearingState(false);
    }
  }, [
    setContainers,
    setStacks,
    setUnusedImages,
    setUnusedImagesCount,
    setSelectedContainers,
    setSelectedImages,
    setDockerHubDataPulled,
    setDataFetched,
    setError,
    fetchContainers,
    setClearingState,
  ]);

  const handlePull = useCallback(
    async (additionalParams = {}) => {
      const {
        setPortainerInstancesFromAPI,
        setLastPullTime,
        fetchDockerHubCredentials,
        dockerHubCredentials,
      } = additionalParams;
      try {
        setPulling(true);
        setError(null);
        setPullError(null);
        setPullSuccess(null);
        console.log("🔄 Pulling fresh data from Docker Hub...");

        const pullPromise = axios.post(
          `${API_BASE_URL}/api/containers/pull`,
          {},
          {
            timeout: 300000,
          }
        );

        try {
          const cachedResponse = await axios.get(`${API_BASE_URL}/api/containers`);
          if (cachedResponse.data.grouped && cachedResponse.data.stacks) {
            const apiContainers = cachedResponse.data.containers || [];
            const updatedContainers = apiContainers.map((apiContainer) => {
              if (successfullyUpdatedContainersRef.current.has(apiContainer.id)) {
                if (!apiContainer.hasUpdate) {
                  successfullyUpdatedContainersRef.current.delete(apiContainer.id);
                }
                return { ...apiContainer, hasUpdate: false };
              }
              return apiContainer;
            });
            setContainers(updatedContainers);
            setStacks(cachedResponse.data.stacks || []);
            setUnusedImagesCount(cachedResponse.data.unusedImagesCount || 0);

            if (cachedResponse.data.portainerInstances && setPortainerInstancesFromAPI) {
              setPortainerInstancesFromAPI(cachedResponse.data.portainerInstances);
            }
            setDataFetched(true);
          }
        } catch (cacheErr) {
          console.log("No cached data available yet");
        }

        const response = await pullPromise;

        if (response.data.success === false) {
          throw new Error(
            response.data.error || response.data.message || "Failed to pull container data"
          );
        }

        if (response.data.grouped && response.data.stacks) {
          const apiContainers = response.data.containers || [];
          const updatedContainers = apiContainers.map((apiContainer) => {
            if (successfullyUpdatedContainersRef.current.has(apiContainer.id)) {
              if (!apiContainer.hasUpdate) {
                successfullyUpdatedContainersRef.current.delete(apiContainer.id);
              }
              return { ...apiContainer, hasUpdate: false };
            }
            return apiContainer;
          });
          setContainers(updatedContainers);
          setStacks(response.data.stacks || []);
          setUnusedImagesCount(response.data.unusedImagesCount || 0);

          if (response.data.portainerInstances && setPortainerInstancesFromAPI) {
            setPortainerInstancesFromAPI(response.data.portainerInstances);
          }

          setDockerHubDataPulled(true);
          localStorage.setItem("dockerHubDataPulled", JSON.stringify(true));
          if (setLastPullTime) {
            const pullTime = new Date();
            setLastPullTime(pullTime);
            localStorage.setItem("lastPullTime", pullTime.toISOString());
          }
        } else {
          const apiContainers = Array.isArray(response.data) ? response.data : [];
          const updatedContainers = apiContainers.map((apiContainer) => {
            if (successfullyUpdatedContainersRef.current.has(apiContainer.id)) {
              if (!apiContainer.hasUpdate) {
                successfullyUpdatedContainersRef.current.delete(apiContainer.id);
              }
              return { ...apiContainer, hasUpdate: false };
            }
            return apiContainer;
          });
          setContainers(updatedContainers);
          setStacks([]);
          setUnusedImagesCount(0);
        }

        setError(null);
        setDataFetched(true);
        await fetchUnusedImages();
        setPullSuccess("Data pulled successfully!");
      } catch (err) {
        // fetchDockerHubCredentials and dockerHubCredentials come from additionalParams
        // They're optional and may not be provided, so handle gracefully
        const errorMessage = await handleDockerHubError(
          err,
          fetchDockerHubCredentials || null,
          dockerHubCredentials || null,
          setError
        );
        setPullError(errorMessage);
        console.error("Error pulling containers:", err);
      } finally {
        setPulling(false);
      }
    },
    [
      setPulling,
      setError,
      setPullError,
      setPullSuccess,
      setContainers,
      setStacks,
      setUnusedImagesCount,
      setDockerHubDataPulled,
      setDataFetched,
      fetchUnusedImages,
      successfullyUpdatedContainersRef,
    ]
  );

  return {
    upgrading,
    batchUpgrading,
    handleUpgrade,
    handleBatchUpgrade,
    handleDeleteImage,
    handleDeleteImages,
    handleClear,
    handlePull,
    deletingImages,
  };
};

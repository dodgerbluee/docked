import { useCallback } from "react";
import { TAB_NAMES, SETTINGS_TABS } from "../constants/apiConstants";
import { CONTAINERS_CONTENT_TABS } from "../constants/containersPage";

/**
 * useAddSourceModal Hook
 * Handles AddSourceModal success logic
 */
export function useAddSourceModal({
  fetchSourceInstances,
  fetchContainers,
  handleNewInstanceDataFetch,
  setSourceInstancesFromAPI,
  setActiveTab,
  setContentTab,
  setSelectedSourceInstances,
  setSettingsTab,
  editingSourceInstance,
  activeTab,
  settingsTab,
  closeModal,
}) {
  const handleModalSuccess = useCallback(
    async (newInstanceData) => {
      // Refresh source instances list and get the updated instances
      const updatedInstances = await fetchSourceInstances();

      // Check if we're on the settings page - if so, stay there and don't navigate
      const isOnSettingsPage =
        activeTab === TAB_NAMES.SETTINGS && settingsTab === SETTINGS_TABS.SOURCES;

      // Check if we're on the Containers page
      const isOnContainersPage = activeTab === TAB_NAMES.CONTAINERS;

      // If this is a new instance (not editing), fetch data for it
      if (!editingSourceInstance && newInstanceData) {
        // Find the new instance in the updated list to get the correct name
        // The name might be different if backend used hostname as default
        const newInstance = updatedInstances.find(
          (inst) => inst.id === newInstanceData.id || inst.url === newInstanceData.url
        );

        // Ensure the instance is in state before setting active tab to prevent safety check redirect
        if (updatedInstances.length > 0) {
          setSourceInstancesFromAPI(updatedInstances);
        }

        // Use the found instance or fallback to newInstanceData
        const instanceToUse = newInstance || newInstanceData;

        if (isOnSettingsPage) {
          // Just refresh containers in the background without navigating
          fetchContainers(false);
        } else if (isOnContainersPage || activeTab === TAB_NAMES.SUMMARY) {
          // We're on the Containers page or Summary page - navigate immediately, then fetch in background
          // Navigate to Containers page (if not already there) and filter to this instance
          setActiveTab(TAB_NAMES.CONTAINERS);
          setSelectedSourceInstances(new Set([instanceToUse.name]));

          // Set content tab to "All" to show all containers for this instance
          setContentTab(CONTAINERS_CONTENT_TABS.ALL);

          // Close modal immediately before fetching to avoid delay
          closeModal();

          // Fetch containers for the new instance in the background (non-blocking)
          fetchContainers(true, instanceToUse.url).catch((err) => {
            console.error("Error fetching containers for new instance:", err);
          });
        } else {
          // Use the found instance or fallback to newInstanceData
          await handleNewInstanceDataFetch(instanceToUse);
        }
      } else {
        // For edits, just refresh all data
        fetchContainers();
        closeModal();
      }

      // Only close modal here if we haven't already closed it above
      if (!(isOnContainersPage || activeTab === TAB_NAMES.SUMMARY) || editingSourceInstance) {
        closeModal();
      }

      // Trigger refresh in Settings component to update the auth method badges
      // If we're on the settings page, trigger a refresh
      if (isOnSettingsPage) {
        // The Settings component will refresh when the sources section is active
        // But we can also force a refresh by calling fetchSourceInstances
        // which will update App's state, and Settings will pick it up
        await fetchSourceInstances();
      }
    },
    [
      fetchSourceInstances,
      fetchContainers,
      handleNewInstanceDataFetch,
      setSourceInstancesFromAPI,
      setActiveTab,
      setContentTab,
      setSelectedSourceInstances,
      editingSourceInstance,
      activeTab,
      settingsTab,
      closeModal,
    ]
  );

  return {
    handleModalSuccess,
  };
}

import { useCallback } from "react";
import { TAB_NAMES, SETTINGS_TABS } from "../constants/apiConstants";
import { PORTAINER_CONTENT_TABS } from "../constants/portainerPage";

/**
 * useAddPortainerModal Hook
 * Handles AddPortainerModal success logic
 */
export function useAddPortainerModal({
  fetchPortainerInstances,
  fetchContainers,
  handleNewInstanceDataFetch,
  setPortainerInstancesFromAPI,
  setActiveTab,
  setContentTab,
  setSelectedPortainerInstances,
  setSettingsTab,
  editingPortainerInstance,
  activeTab,
  settingsTab,
  closeModal,
}) {
  const handleModalSuccess = useCallback(
    async (newInstanceData) => {
      // Refresh Portainer instances list and get the updated instances
      const updatedInstances = await fetchPortainerInstances();

      // Check if we're on the settings page - if so, stay there and don't navigate
      const isOnSettingsPage = activeTab === TAB_NAMES.SETTINGS && settingsTab === SETTINGS_TABS.PORTAINER;

      // Check if we're on the Portainer page
      const isOnPortainerPage = activeTab === TAB_NAMES.PORTAINER;

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

        if (isOnSettingsPage) {
          // Just refresh containers in the background without navigating
          fetchContainers(false);
        } else if (isOnPortainerPage || activeTab === TAB_NAMES.SUMMARY) {
          // We're on the Portainer page or Summary page - navigate immediately, then fetch in background
          // Navigate to Portainer page (if not already there) and filter to this instance
          setActiveTab(TAB_NAMES.PORTAINER);
          setSelectedPortainerInstances(new Set([instanceToUse.name]));

          // Set content tab to "All" to show all containers for this instance
          setContentTab(PORTAINER_CONTENT_TABS.ALL);

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
      if (!(isOnPortainerPage || activeTab === TAB_NAMES.SUMMARY) || editingPortainerInstance) {
        closeModal();
      }

      // Trigger refresh in Settings component to update the auth method badges
      // If we're on the settings page, trigger a refresh
      if (isOnSettingsPage) {
        // The Settings component will refresh when the portainer section is active
        // But we can also force a refresh by calling fetchPortainerInstances
        // which will update App's state, and Settings will pick it up
        await fetchPortainerInstances();
      }
    },
    [
      fetchPortainerInstances,
      fetchContainers,
      handleNewInstanceDataFetch,
      setPortainerInstancesFromAPI,
      setActiveTab,
      setContentTab,
      setSelectedPortainerInstances,
      setSettingsTab,
      editingPortainerInstance,
      activeTab,
      settingsTab,
      closeModal,
    ]
  );

  return {
    handleModalSuccess,
  };
}


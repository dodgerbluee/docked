import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";

/**
 * usePortainerSettings Hook
 * Manages Portainer instances
 */
export function usePortainerSettings({
  onPortainerInstancesChange,
  refreshInstances,
  activeSection,
}) {
  const [portainerInstances, setPortainerInstances] = useState([]);
  const [editingInstance, setEditingInstance] = useState(null);
  const [instanceForm, setInstanceForm] = useState({
    name: "",
    url: "",
    username: "",
    password: "",
  });
  const [instanceError, setInstanceError] = useState("");
  const [instanceSuccess, setInstanceSuccess] = useState("");
  const [instanceLoading, setInstanceLoading] = useState(false);

  const fetchPortainerInstances = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/portainer/instances`);
      if (response.data.success) {
        setPortainerInstances(response.data.instances || []);
      }
    } catch (err) {
      console.error("Error fetching Portainer instances:", err);
    }
  }, []);

  useEffect(() => {
    fetchPortainerInstances();
  }, [fetchPortainerInstances]);

  useEffect(() => {
    if (activeSection === "portainer") {
      fetchPortainerInstances();
    }
  }, [activeSection, fetchPortainerInstances]);

  useEffect(() => {
    if (refreshInstances && activeSection === "portainer") {
      const timeout = setTimeout(() => {
        fetchPortainerInstances();
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [refreshInstances, activeSection, fetchPortainerInstances]);

  const handleInstanceSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setInstanceError("");
      setInstanceSuccess("");
      setInstanceLoading(true);

      try {
        if (editingInstance) {
          await axios.put(
            `${API_BASE_URL}/api/portainer/instances/${editingInstance.id}`,
            instanceForm
          );
          setInstanceSuccess("Portainer instance updated successfully!");
        } else {
          await axios.post(`${API_BASE_URL}/api/portainer/instances`, instanceForm);
          setInstanceSuccess("Portainer instance added successfully!");
        }

        setInstanceForm({ name: "", url: "", username: "", password: "" });
        setEditingInstance(null);
        await fetchPortainerInstances();
        if (onPortainerInstancesChange) {
          onPortainerInstancesChange();
        }
        setTimeout(() => setInstanceSuccess(""), 3000);
      } catch (err) {
        setInstanceError(err.response?.data?.error || "Failed to save Portainer instance");
      } finally {
        setInstanceLoading(false);
      }
    },
    [editingInstance, instanceForm, fetchPortainerInstances, onPortainerInstancesChange]
  );

  const handleDeleteInstance = useCallback(
    async (id) => {
      try {
        await axios.delete(`${API_BASE_URL}/api/portainer/instances/${id}`);
        setInstanceSuccess("Portainer instance deleted successfully!");
        await fetchPortainerInstances();
        if (onPortainerInstancesChange) {
          onPortainerInstancesChange();
        }
        setTimeout(() => setInstanceSuccess(""), 3000);
      } catch (err) {
        setInstanceError(err.response?.data?.error || "Failed to delete Portainer instance");
      }
    },
    [fetchPortainerInstances, onPortainerInstancesChange]
  );

  const handleEditInstance = useCallback((instance) => {
    setEditingInstance(instance);
    setInstanceForm({
      name: instance.name,
      url: instance.url,
      username: instance.username || "",
      password: "", // Don't pre-fill password for security
    });
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingInstance(null);
    setInstanceForm({ name: "", url: "", username: "", password: "" });
    setInstanceError("");
  }, []);

  return {
    portainerInstances,
    editingInstance,
    instanceForm,
    setInstanceForm,
    instanceError,
    instanceSuccess,
    instanceLoading,
    handleInstanceSubmit,
    handleEditInstance,
    handleDeleteInstance,
    handleCancelEdit,
    fetchPortainerInstances,
  };
}

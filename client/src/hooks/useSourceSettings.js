import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";

/**
 * useSourceSettings Hook
 * Manages source instances
 */
export function useSourceSettings({
  onSourceInstancesChange,
  refreshInstances,
  activeSection,
}) {
  const [sourceInstances, setSourceInstances] = useState([]);
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

  const fetchSourceInstances = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/sources/instances`);
      if (response.data.success) {
        setSourceInstances(response.data.instances || []);
      }
    } catch (err) {
      console.error("Error fetching source instances:", err);
    }
  }, []);

  useEffect(() => {
    fetchSourceInstances();
  }, [fetchSourceInstances]);

  useEffect(() => {
    if (activeSection === "sources" || activeSection === "portainer") {
      fetchSourceInstances();
    }
  }, [activeSection, fetchSourceInstances]);

  useEffect(() => {
    if (refreshInstances && (activeSection === "sources" || activeSection === "portainer")) {
      const timeout = setTimeout(() => {
        fetchSourceInstances();
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [refreshInstances, activeSection, fetchSourceInstances]);

  const handleInstanceSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setInstanceError("");
      setInstanceSuccess("");
      setInstanceLoading(true);

      try {
        if (editingInstance) {
          await axios.put(
            `${API_BASE_URL}/api/sources/instances/${editingInstance.id}`,
            instanceForm
          );
          setInstanceSuccess("Source instance updated successfully!");
        } else {
          await axios.post(`${API_BASE_URL}/api/sources/instances`, instanceForm);
          setInstanceSuccess("Source instance added successfully!");
        }

        setInstanceForm({ name: "", url: "", username: "", password: "" });
        setEditingInstance(null);
        await fetchSourceInstances();
        if (onSourceInstancesChange) {
          onSourceInstancesChange();
        }
        setTimeout(() => setInstanceSuccess(""), 3000);
      } catch (err) {
        setInstanceError(err.response?.data?.error || "Failed to save source instance");
      } finally {
        setInstanceLoading(false);
      }
    },
    [editingInstance, instanceForm, fetchSourceInstances, onSourceInstancesChange]
  );

  const handleDeleteInstance = useCallback(
    async (id) => {
      try {
        await axios.delete(`${API_BASE_URL}/api/sources/instances/${id}`);
        setInstanceSuccess("Source instance deleted successfully!");
        await fetchSourceInstances();
        if (onSourceInstancesChange) {
          onSourceInstancesChange();
        }
        setTimeout(() => setInstanceSuccess(""), 3000);
      } catch (err) {
        setInstanceError(err.response?.data?.error || "Failed to delete source instance");
      }
    },
    [fetchSourceInstances, onSourceInstancesChange]
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
    sourceInstances,
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
    fetchSourceInstances,
  };
}

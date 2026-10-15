import { useState, useEffect, useCallback } from "react";
import { graphqlClient } from "../graphql/client";
import {
  SOURCE_INSTANCES_QUERY,
  CREATE_SOURCE_INSTANCE_MUTATION,
  UPDATE_SOURCE_INSTANCE_MUTATION,
  DELETE_SOURCE_INSTANCE_MUTATION,
} from "../graphql/queries";

/**
 * useSourceSettings Hook
 * Manages source instances via GraphQL
 */
export function useSourceSettings({ onSourceInstancesChange, refreshInstances, activeSection }) {
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
      const result = await graphqlClient.query(SOURCE_INSTANCES_QUERY).toPromise();
      if (result.data?.sourceInstances) {
        setSourceInstances(result.data.sourceInstances);
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
        const authType = instanceForm.username ? "PASSWORD" : "APIKEY";
        const input = {
          name: instanceForm.name,
          url: instanceForm.url,
          authType,
        };
        if (instanceForm.username) {
          input.username = instanceForm.username;
        }
        if (instanceForm.password) {
          input.password = instanceForm.password;
        }

        if (editingInstance) {
          const result = await graphqlClient
            .mutation(UPDATE_SOURCE_INSTANCE_MUTATION, {
              id: editingInstance.id,
              input,
            })
            .toPromise();
          if (result.error) throw new Error(result.error.message);
          setInstanceSuccess("Source instance updated successfully!");
        } else {
          const result = await graphqlClient
            .mutation(CREATE_SOURCE_INSTANCE_MUTATION, { input })
            .toPromise();
          if (result.error) throw new Error(result.error.message);
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
        setInstanceError(err.message || "Failed to save source instance");
      } finally {
        setInstanceLoading(false);
      }
    },
    [editingInstance, instanceForm, fetchSourceInstances, onSourceInstancesChange]
  );

  const handleDeleteInstance = useCallback(
    async (id) => {
      try {
        const result = await graphqlClient
          .mutation(DELETE_SOURCE_INSTANCE_MUTATION, { id })
          .toPromise();
        if (result.error) throw new Error(result.error.message);
        setInstanceSuccess("Source instance deleted successfully!");
        await fetchSourceInstances();
        if (onSourceInstancesChange) {
          onSourceInstancesChange();
        }
        setTimeout(() => setInstanceSuccess(""), 3000);
      } catch (err) {
        setInstanceError(err.message || "Failed to delete source instance");
      }
    },
    [fetchSourceInstances, onSourceInstancesChange]
  );

  const handleEditInstance = useCallback((instance) => {
    setEditingInstance(instance);
    setInstanceForm({
      name: instance.name,
      url: instance.url,
      username: "",
      password: "",
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

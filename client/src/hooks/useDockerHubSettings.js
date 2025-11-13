import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";

/**
 * useDockerHubSettings Hook
 * Manages Docker Hub credentials
 */
export function useDockerHubSettings() {
  const [dockerHubCredentials, setDockerHubCredentials] = useState(null);
  const [showDockerHubModal, setShowDockerHubModal] = useState(false);
  const [dockerHubSuccess, setDockerHubSuccess] = useState("");

  const fetchDockerHubCredentials = useCallback(async () => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/docker-hub/credentials`
      );
      if (response.data.success) {
        setDockerHubCredentials(response.data.credentials);
      }
    } catch (err) {
      console.error("Error fetching Docker Hub credentials:", err);
    }
  }, []);

  useEffect(() => {
    fetchDockerHubCredentials();
  }, [fetchDockerHubCredentials]);

  const handleDockerHubModalSuccess = useCallback(async () => {
    setDockerHubSuccess("Docker Hub credentials saved successfully!");
    await fetchDockerHubCredentials();
    setTimeout(() => setDockerHubSuccess(""), 3000);
  }, [fetchDockerHubCredentials]);

  const handleDeleteDockerHubCreds = useCallback(async () => {
    try {
      const response = await axios.delete(
        `${API_BASE_URL}/api/docker-hub/credentials`
      );
      if (response.data.success) {
        setDockerHubSuccess("Docker Hub credentials removed successfully!");
        setDockerHubCredentials(null);
        await fetchDockerHubCredentials();
        setTimeout(() => setDockerHubSuccess(""), 3000);
      }
    } catch (err) {
      console.error("Failed to remove Docker Hub credentials:", err);
    }
  }, [fetchDockerHubCredentials]);

  return {
    dockerHubCredentials,
    showDockerHubModal,
    setShowDockerHubModal,
    dockerHubSuccess,
    handleDockerHubModalSuccess,
    handleDeleteDockerHubCreds,
    fetchDockerHubCredentials,
  };
}


import { useState, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

/**
 * Custom hook for Docker Hub credentials management
 * Handles fetching and storing Docker Hub credentials
 */
export const useDockerHubCredentials = (isAuthenticated, authToken) => {
  const [dockerHubCredentials, setDockerHubCredentials] = useState(null);

  // Fetch Docker Hub credentials
  const fetchDockerHubCredentials = useCallback(async () => {
    if (!isAuthenticated || !authToken) return null;
    try {
      const response = await axios.get(`${API_BASE_URL}/api/docker-hub/credentials`);
      if (response.data.success) {
        setDockerHubCredentials(response.data.credentials);
        return response.data.credentials;
      } else {
        setDockerHubCredentials(null);
        return null;
      }
    } catch (err) {
      // If credentials don't exist, that's fine - set to null
      setDockerHubCredentials(null);
      return null;
    }
  }, [isAuthenticated, authToken]);

  return {
    dockerHubCredentials,
    setDockerHubCredentials,
    fetchDockerHubCredentials,
  };
};


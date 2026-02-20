import { useState, useEffect, useCallback } from "react";

/**
 * useDockerHubSettings Hook
 * Manages Docker Hub credentials
 */
export function useDockerHubSettings() {
  const [dockerHubCredentials, setDockerHubCredentials] = useState(null);
  const [showDockerHubModal, setShowDockerHubModal] = useState(false);
  const [dockerHubSuccess, setDockerHubSuccess] = useState("");
  const [dockerHubDisabledMessage, setDockerHubDisabledMessage] = useState("");

  const fetchDockerHubCredentials = useCallback(async () => {
    // Docker Hub credentials are no longer stored by Docked.
    // Authentication for Docker Hub pulls should be configured on the host via `docker login`.
    setDockerHubCredentials(null);
    setDockerHubDisabledMessage(
      "Docker Hub credentials are configured on the host (run `docker login`)."
    );
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
    setDockerHubCredentials(null);
    setDockerHubSuccess(
      "Docker Hub credentials are managed on the host (run `docker logout` if needed)."
    );
    setTimeout(() => setDockerHubSuccess(""), 3000);
  }, []);

  return {
    dockerHubCredentials,
    showDockerHubModal,
    setShowDockerHubModal,
    dockerHubSuccess,
    dockerHubDisabledMessage,
    handleDockerHubModalSuccess,
    handleDeleteDockerHubCreds,
    fetchDockerHubCredentials,
  };
}

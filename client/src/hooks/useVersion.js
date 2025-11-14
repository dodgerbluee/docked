import { useState, useEffect } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

/**
 * Custom hook to fetch application version from the API
 * 
 * @returns {Object} Version information object
 * @returns {string|null} version - Application version string (e.g., "1.2.5" or "1.2.5-dev")
 * @returns {string|null} environment - Current environment ("development" or "production")
 * @returns {boolean} isDevBuild - Whether this is a local development build
 * @returns {boolean} loading - Whether the version is currently being fetched
 * 
 * @example
 * const { version, isDevBuild, loading } = useVersion();
 * if (loading) return <Spinner />;
 * return <div>Version: {version || "Development Build"}</div>;
 */
export const useVersion = () => {
  const [version, setVersion] = useState(null);
  const [environment, setEnvironment] = useState(null);
  const [isDevBuild, setIsDevBuild] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    /**
     * Fetches version information from the API endpoint
     * Gracefully handles errors since version is optional
     */
    const fetchVersion = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/version`);
        setVersion(response.data.version ?? null);
        setEnvironment(response.data.environment ?? null);
        setIsDevBuild(response.data.isDevBuild ?? false);
      } catch (error) {
        // Silently fail - version is optional and should not break the app
        console.debug("Could not fetch version:", error);
        setVersion(null);
        setEnvironment(null);
        setIsDevBuild(false);
      } finally {
        setLoading(false);
      }
    };

    fetchVersion();
  }, []);

  return { version, environment, isDevBuild, loading };
};


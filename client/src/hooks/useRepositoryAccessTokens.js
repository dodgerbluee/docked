import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";

/**
 * useRepositoryAccessTokens Hook
 * Manages repository access tokens (GitHub/GitLab)
 */
export function useRepositoryAccessTokens({ activeSection }) {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchTokens = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await axios.get(`${API_BASE_URL}/api/repository-access-tokens`);
      if (response.data.success) {
        setTokens(response.data.tokens || []);
      }
    } catch (err) {
      console.error("Error fetching repository access tokens:", err);
      setError(err.response?.data?.error || "Failed to fetch repository access tokens");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeSection === "portainer") {
      fetchTokens();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  const createOrUpdateToken = useCallback(
    async (provider, name, accessToken, tokenId = null) => {
      try {
        setLoading(true);
        setError("");
        const response = await axios.post(`${API_BASE_URL}/api/repository-access-tokens`, {
          provider,
          name,
          accessToken,
          tokenId,
        });
        if (response.data.success) {
          await fetchTokens();
          return { success: true, id: response.data.id };
        }
        return { success: false, error: response.data.error || "Failed to save token" };
      } catch (err) {
        const errorMessage = err.response?.data?.error || "Failed to save repository access token";
        setError(errorMessage);
        return { success: false, error: errorMessage };
      } finally {
        setLoading(false);
      }
    },
    [fetchTokens]
  );

  const deleteToken = useCallback(
    async (id) => {
      try {
        setLoading(true);
        setError("");
        const response = await axios.delete(`${API_BASE_URL}/api/repository-access-tokens/${id}`);
        if (response.data.success) {
          await fetchTokens();
          return { success: true };
        }
        return { success: false, error: response.data.error || "Failed to delete token" };
      } catch (err) {
        const errorMessage =
          err.response?.data?.error || "Failed to delete repository access token";
        setError(errorMessage);
        return { success: false, error: errorMessage };
      } finally {
        setLoading(false);
      }
    },
    [fetchTokens]
  );

  return {
    tokens,
    loading,
    error,
    fetchTokens,
    createOrUpdateToken,
    deleteToken,
  };
}

import { useState, useEffect, useCallback } from "react";
import { graphqlClient } from "../graphql/client";
import {
  REPOSITORY_TOKENS_QUERY,
  SAVE_REPOSITORY_TOKEN_MUTATION,
  DELETE_REPOSITORY_TOKEN_MUTATION,
} from "../graphql/queries";

/**
 * useRepositoryAccessTokens Hook
 * Manages repository access tokens (GitHub/GitLab) via GraphQL
 */
export function useRepositoryAccessTokens({ activeSection }) {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchTokens = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const result = await graphqlClient.query(REPOSITORY_TOKENS_QUERY).toPromise();
      if (result.error) throw new Error(result.error.message);
      setTokens(result.data?.repositoryTokens || []);
    } catch (err) {
      console.error("Error fetching repository access tokens:", err);
      setError(err.message || "Failed to fetch repository access tokens");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeSection === "sources") {
      fetchTokens();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  const createOrUpdateToken = useCallback(
    async (provider, _name, accessToken, _tokenId = null) => {
      try {
        setLoading(true);
        setError("");
        const result = await graphqlClient
          .mutation(SAVE_REPOSITORY_TOKEN_MUTATION, {
            input: { provider, token: accessToken },
          })
          .toPromise();
        if (result.error) throw new Error(result.error.message);
        if (result.data?.saveRepositoryToken) {
          await fetchTokens();
          return { success: true, id: result.data.saveRepositoryToken.id };
        }
        return { success: false, error: "Failed to save token" };
      } catch (err) {
        const errorMessage = err.message || "Failed to save repository access token";
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
        const result = await graphqlClient
          .mutation(DELETE_REPOSITORY_TOKEN_MUTATION, { id })
          .toPromise();
        if (result.error) throw new Error(result.error.message);
        if (result.data?.deleteRepositoryToken?.success) {
          await fetchTokens();
          return { success: true };
        }
        return { success: false, error: "Failed to delete token" };
      } catch (err) {
        const errorMessage = err.message || "Failed to delete repository access token";
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

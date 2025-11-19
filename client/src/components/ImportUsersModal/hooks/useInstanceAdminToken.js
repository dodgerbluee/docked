import { useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../utils/api";

/**
 * useInstanceAdminToken Hook
 * Handles instance admin token generation, regeneration, and verification
 */
export function useInstanceAdminToken({
  setGenerating,
  setRegenerating,
  setVerifying,
  setVerificationStatus,
  setVerificationTokens,
  setUserStepErrors,
  setError,
  importedUsers,
}) {
  const handleGenerateToken = useCallback(
    async (username) => {
      setGenerating((prev) => ({ ...prev, [username]: true }));

      try {
        const tokenAxios = axios.create({
          baseURL: API_BASE_URL,
          headers: { "Content-Type": "application/json" },
        });
        delete tokenAxios.defaults.headers.common["Authorization"];

        const response = await tokenAxios.post("/api/auth/generate-instance-admin-token", {
          username,
        });

        if (response.data.success && response.data.token) {
          setVerificationTokens((prev) => ({ ...prev, [username]: response.data.token }));
        }

        setError("");
      } catch (err) {
        console.error("Error generating token:", err);
        setError(err.response?.data?.error || "Failed to generate token. Check server logs.");
      } finally {
        setGenerating((prev) => ({ ...prev, [username]: false }));
      }
    },
    [setGenerating, setVerificationTokens, setError]
  );

  const handleRegenerateToken = useCallback(
    async (username) => {
      setRegenerating((prev) => ({ ...prev, [username]: true }));

      try {
        const tokenAxios = axios.create({
          baseURL: API_BASE_URL,
          headers: { "Content-Type": "application/json" },
        });
        delete tokenAxios.defaults.headers.common["Authorization"];

        const userExists = importedUsers.includes(username);
        const endpoint = userExists
          ? "/api/auth/regenerate-instance-admin-token"
          : "/api/auth/generate-instance-admin-token";

        const response = await tokenAxios.post(endpoint, {
          username,
        });

        if (response.data.success && response.data.token) {
          setVerificationTokens((prev) => ({ ...prev, [username]: response.data.token }));
        }

        setError("");
      } catch (err) {
        console.error("Error generating/regenerating token:", err);
        setError(
          err.response?.data?.error || "Failed to generate/regenerate token. Check server logs."
        );
      } finally {
        setRegenerating((prev) => ({ ...prev, [username]: false }));
      }
    },
    [setRegenerating, setVerificationTokens, setError, importedUsers]
  );

  const handleVerifyToken = useCallback(
    async (username, token) => {
      setVerifying((prev) => ({ ...prev, [username]: true }));

      // Clear any previous errors
      setUserStepErrors((prev) => {
        const updated = { ...prev };
        if (updated[username]) {
          delete updated[username].instance_admin_verification;
        }
        return updated;
      });

      try {
        const verifyAxios = axios.create({
          baseURL: API_BASE_URL,
          headers: { "Content-Type": "application/json" },
        });
        delete verifyAxios.defaults.headers.common["Authorization"];

        const response = await verifyAxios.post("/api/auth/verify-instance-admin-token", {
          username,
          token,
        });

        if (response.data.success) {
          setVerificationStatus((prev) => ({ ...prev, [username]: true }));
          setUserStepErrors((prev) => {
            const updated = { ...prev };
            if (updated[username]) {
              delete updated[username].instance_admin_verification;
            }
            return updated;
          });
          return true;
        } else {
          const errorMsg =
            response.data.error ||
            "Invalid token. Please check the server logs for the correct token.";
          setVerificationStatus((prev) => ({ ...prev, [username]: false }));
          setUserStepErrors((prev) => ({
            ...prev,
            [username]: {
              ...prev[username],
              instance_admin_verification: errorMsg,
            },
          }));
          return false;
        }
      } catch (err) {
        const errorMsg =
          err.response?.data?.error ||
          "Invalid token. Please check the server logs for the correct token.";
        setVerificationStatus((prev) => ({ ...prev, [username]: false }));
        setUserStepErrors((prev) => ({
          ...prev,
          [username]: {
            ...prev[username],
            instance_admin_verification: errorMsg,
          },
        }));
        return false;
      } finally {
        setVerifying((prev) => ({ ...prev, [username]: false }));
      }
    },
    [setVerifying, setVerificationStatus, setUserStepErrors]
  );

  return {
    handleGenerateToken,
    handleRegenerateToken,
    handleVerifyToken,
  };
}

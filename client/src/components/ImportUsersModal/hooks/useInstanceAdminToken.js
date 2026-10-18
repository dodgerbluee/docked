import { useCallback } from "react";
import { graphqlClient } from "../../../graphql/client";
import {
  GENERATE_INSTANCE_ADMIN_TOKEN_MUTATION,
  REGENERATE_INSTANCE_ADMIN_TOKEN_MUTATION,
  VERIFY_INSTANCE_ADMIN_TOKEN_MUTATION,
} from "../../../graphql/queries";

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
        const { data, error } = await graphqlClient
          .mutation(GENERATE_INSTANCE_ADMIN_TOKEN_MUTATION, { username })
          .toPromise();

        const result = data?.generateInstanceAdminToken;
        if (result?.success) {
          // The token is deliberately NOT returned by the API (it is only
          // written to the container logs, so possessing it proves host
          // access). Store a sentinel so the step knows a pending token
          // exists and does not re-generate on every render.
          setVerificationTokens((prev) => ({ ...prev, [username]: "generated" }));
          setError("");
        } else {
          setError(
            result?.error || error?.message || "Failed to generate token. Check server logs."
          );
        }
      } catch (err) {
        console.error("Error generating token:", err);
        setError("Failed to generate token. Check server logs.");
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
        const userExists = importedUsers.includes(username);
        const doc = userExists
          ? REGENERATE_INSTANCE_ADMIN_TOKEN_MUTATION
          : GENERATE_INSTANCE_ADMIN_TOKEN_MUTATION;

        const { data, error } = await graphqlClient.mutation(doc, { username }).toPromise();

        const result = userExists
          ? data?.regenerateInstanceAdminToken
          : data?.generateInstanceAdminToken;
        if (result?.success) {
          // Sentinel only - the token itself is logged, never returned.
          setVerificationTokens((prev) => ({ ...prev, [username]: "generated" }));
          setError("");
        } else {
          setError(
            result?.error ||
              error?.message ||
              "Failed to generate/regenerate token. Check server logs."
          );
        }
      } catch (err) {
        console.error("Error generating/regenerating token:", err);
        setError("Failed to generate/regenerate token. Check server logs.");
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

      const markFailure = (detail) => {
        setVerificationStatus((prev) => ({ ...prev, [username]: false }));
        setUserStepErrors((prev) => ({
          ...prev,
          [username]: {
            ...prev[username],
            instance_admin_verification:
              detail || "Invalid token. Please check the server logs for the correct token.",
          },
        }));
      };

      try {
        const { data, error } = await graphqlClient
          .mutation(VERIFY_INSTANCE_ADMIN_TOKEN_MUTATION, { username, token })
          .toPromise();

        const result = data?.verifyInstanceAdminToken;
        if (result?.success) {
          setVerificationStatus((prev) => ({ ...prev, [username]: true }));
          setUserStepErrors((prev) => {
            const updated = { ...prev };
            if (updated[username]) {
              delete updated[username].instance_admin_verification;
            }
            return updated;
          });
          return true;
        }
        markFailure(result?.error || result?.message || error?.message);
        return false;
      } catch (err) {
        markFailure(err?.message);
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

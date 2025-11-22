import { useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../utils/api";
import { getErrorMessage } from "../../../utils/errorHandling";

// Step types
const STEP_TYPES = {
  INSTANCE_ADMIN_VERIFICATION: "instance_admin_verification",
  PASSWORD: "password",
  PORTAINER: "portainer",
  DOCKERHUB: "dockerhub",
  DISCORD: "discord",
};

/**
 * useUserCreation Hook
 * Handles user creation logic for the import process
 */
export function useUserCreation({
  currentUser,
  userPasswords,
  userCredentials,
  userSkippedSteps,
  verificationStatus,
  verificationTokens,
  setImporting,
  setError,
  setImportedUsers,
  setImportErrors,
  setVerificationTokens,
}) {
  const createUserWithConfig = useCallback(async () => {
    if (!currentUser) return { success: false, imported: false, username: null };

    setImporting(true);
    setError("");

    try {
      const createAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: { "Content-Type": "application/json" },
      });
      delete createAxios.defaults.headers.common["Authorization"];

      const username = currentUser.username;
      const password = userPasswords[username];

      // Check if user was marked as instance admin in JSON
      const wasMarkedAsInstanceAdmin =
        currentUser.instanceAdmin !== undefined
          ? currentUser.instanceAdmin
          : currentUser.instance_admin === true || currentUser.instance_admin === 1;

      // Check if instance admin verification step was skipped
      const skippedSteps = userSkippedSteps[username] || new Set();
      const verificationSkipped = skippedSteps.has(STEP_TYPES.INSTANCE_ADMIN_VERIFICATION);

      // Check if verification was successful
      const verificationSuccessful = verificationStatus[username] === true;

      // User should only be marked as instance admin if:
      // 1. They were marked as instance admin in JSON, AND
      // 2. Verification step was NOT skipped, AND
      // 3. Verification was successful
      const isInstanceAdmin =
        wasMarkedAsInstanceAdmin && !verificationSkipped && verificationSuccessful;

      // Build user data
      const userData = {
        username,
        password,
        email: currentUser.email || null,
        role: currentUser.role || "Administrator",
        instanceAdmin: isInstanceAdmin,
      };

      // Build config data (only include if user has it)
      const configData = {};
      if (
        currentUser.portainerInstances &&
        Array.isArray(currentUser.portainerInstances) &&
        currentUser.portainerInstances.length > 0
      ) {
        configData.portainerInstances = currentUser.portainerInstances;
      }
      if (
        currentUser.dockerHubCredentials !== null &&
        currentUser.dockerHubCredentials !== undefined
      ) {
        configData.dockerHubCredentials = currentUser.dockerHubCredentials;
      }
      if (
        currentUser.discordWebhooks &&
        Array.isArray(currentUser.discordWebhooks) &&
        currentUser.discordWebhooks.length > 0
      ) {
        configData.discordWebhooks = currentUser.discordWebhooks;
      }
      if (
        currentUser.trackedApps &&
        Array.isArray(currentUser.trackedApps) &&
        currentUser.trackedApps.length > 0
      ) {
        configData.trackedApps = currentUser.trackedApps;
      }

      // Build credentials (only include non-skipped steps)
      const credentials = {};

      if (
        !skippedSteps.has(STEP_TYPES.PORTAINER) &&
        userCredentials[username]?.portainerInstances
      ) {
        credentials.portainerInstances = userCredentials[username].portainerInstances;
      }
      if (!skippedSteps.has(STEP_TYPES.DOCKERHUB) && userCredentials[username]?.dockerHub) {
        credentials.dockerHub = userCredentials[username].dockerHub;
      }
      if (!skippedSteps.has(STEP_TYPES.DISCORD) && userCredentials[username]?.discordWebhooks) {
        credentials.discordWebhooks = userCredentials[username].discordWebhooks;
      }

      // Use pre-generated token if available
      const preGeneratedToken = verificationTokens[username];

      // Call endpoint to create user with config
      const response = await createAxios.post("/api/auth/create-user-with-config", {
        userData,
        configData: Object.keys(configData).length > 0 ? configData : null,
        credentials: Object.keys(credentials).length > 0 ? credentials : null,
        skippedSteps: Array.from(skippedSteps),
        verificationToken: preGeneratedToken || null,
      });

      if (response.data.success) {
        // Check if user was skipped (already exists)
        if (response.data.skipped) {
          // User already exists - add to errors but continue with other users
          setImportErrors((prev) => [
            ...prev,
            response.data.message || `User "${username}" already exists`,
          ]);
          // Clear token from temporary storage
          setVerificationTokens((prev) => {
            const updated = { ...prev };
            delete updated[username];
            return updated;
          });
          // Return success but not imported
          return { success: true, imported: false, username };
        }

        // Clear token from temporary storage after user is created
        setVerificationTokens((prev) => {
          const updated = { ...prev };
          delete updated[username];
          return updated;
        });
        setImportedUsers((prev) => [...prev, username]);
        return { success: true, imported: true, username };
      } else {
        setImportErrors((prev) => [
          ...prev,
          `User "${username}": ${response.data.error || "Failed to create user"}`,
        ]);
        return { success: false, imported: false, username };
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || getErrorMessage(err) || "Failed to create user";
      setImportErrors((prev) => [...prev, `User "${currentUser.username}": ${errorMsg}`]);
      setError(errorMsg);
      return { success: false, imported: false, username: currentUser.username };
    } finally {
      setImporting(false);
    }
  }, [
    currentUser,
    userPasswords,
    userCredentials,
    userSkippedSteps,
    verificationStatus,
    verificationTokens,
    setImporting,
    setError,
    setImportedUsers,
    setImportErrors,
    setVerificationTokens,
  ]);

  return {
    createUserWithConfig,
  };
}

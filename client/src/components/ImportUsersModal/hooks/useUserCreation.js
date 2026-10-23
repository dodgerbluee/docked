import { useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../utils/api";
import { getErrorMessage } from "../../../utils/errorHandling";
import { clearAllCaches, getSessionGeneration, isSessionStale } from "../../../utils/cacheRegistry";
import { resetGraphQLClient } from "../../../graphql/client";

// Step types
const STEP_TYPES = {
  INSTANCE_ADMIN_VERIFICATION: "instance_admin_verification",
  PASSWORD: "password",
  DISCORD: "discord",
};

// Best-effort login with the credentials just set for a newly imported
// instance admin, so the rest of the wizard carries an authenticated token.
// The server closes the public bootstrap window the moment an owner exists,
// so later member imports need a session. Non-fatal: if this fails, the next
// create call simply surfaces the server's 403 rather than undoing the admin
// import that already succeeded.
// `generation` is the session generation captured before the create request:
// this is a real session transition (anonymous → authenticated), so a session
// change that happened while the create/bootstrap was in flight means these
// credentials belong to a dead session and must not be installed.
async function bootstrapSessionToken(username, password, generation) {
  try {
    const res = await axios.post(
      `${API_BASE_URL}/api/auth/login`,
      { username, password },
      { headers: { "Content-Type": "application/json" } }
    );
    if (res.data?.success && res.data.token) {
      if (isSessionStale(generation)) return;
      // Mirror useAuth.handleLogin: a fresh urql+graphql-ws pair and a fresh
      // cache generation before installing credentials, so nothing in flight
      // from the pre-login (anonymous bootstrap) window can be deduplicated
      // into, or pass staleness guards against, this session.
      resetGraphQLClient();
      clearAllCaches();
      localStorage.setItem("authToken", res.data.token);
      if (res.data.role) localStorage.setItem("userRole", res.data.role);
      if (res.data.instanceAdmin !== undefined) {
        localStorage.setItem("instanceAdmin", res.data.instanceAdmin ? "true" : "false");
      }
    }
  } catch {
    // ignore — the server gate reports the failure on the next create call
  }
}

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
  verificationInputTokens,
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

    // Captured before the create request: the bootstrap login below installs
    // credentials, so it must know whether the session it belongs to is still
    // the live one by the time the request lands.
    const generation = getSessionGeneration();

    try {
      const createAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: { "Content-Type": "application/json" },
      });
      // Carry the session token when one exists (admin-UI import wizard, or a
      // login-page wizard that already bootstrapped an instance admin). The
      // server requires an authenticated instance admin to create plain
      // accounts once the instance has an owner.
      const sessionToken = localStorage.getItem("authToken");
      if (sessionToken) {
        createAxios.defaults.headers.common["Authorization"] = `Bearer ${sessionToken}`;
      }

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

      if (!skippedSteps.has(STEP_TYPES.DISCORD) && userCredentials[username]?.discordWebhooks) {
        credentials.discordWebhooks = userCredentials[username].discordWebhooks;
      }

      // The server only grants instance-admin when it can atomically consume
      // the pending verification token, so send the exact token the operator
      // read from the container logs and typed into the verification step.
      const enteredToken = (verificationInputTokens[username] || "").trim() || null;

      // Call endpoint to create user with config
      const response = await createAxios.post("/api/auth/create-user-with-config", {
        userData,
        configData: Object.keys(configData).length > 0 ? configData : null,
        credentials: Object.keys(credentials).length > 0 ? credentials : null,
        skippedSteps: Array.from(skippedSteps),
        verificationToken: enteredToken,
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
        // If we just created the instance that now has an owner and we have no
        // session yet, log in with the credentials just set so subsequent
        // member imports in this wizard carry an authenticated token.
        if (isInstanceAdmin && !localStorage.getItem("authToken")) {
          await bootstrapSessionToken(username, password, generation);
        }
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
    verificationInputTokens,
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

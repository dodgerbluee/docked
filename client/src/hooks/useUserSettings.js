import { useState, useEffect, useCallback, useRef } from "react";
import { graphqlClient } from "../graphql/client";
import { getSessionGeneration, isSessionStale } from "../utils/cacheRegistry";
import { ME_QUERY, UPDATE_USERNAME_MUTATION, UPDATE_PASSWORD_MUTATION } from "../graphql/queries";

/**
 * useUserSettings Hook
 * Manages user information, username, and password updates
 */
export function useUserSettings({ username, onUsernameUpdate, onPasswordUpdateSuccess }) {
  const [userInfo, setUserInfo] = useState(null);
  const [newUsername, setNewUsername] = useState("");
  const [usernamePassword, setUsernamePassword] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [usernameSuccess, setUsernameSuccess] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Pending auto-logout after a password change. Kept in a ref so unmount
  // (which a session change always triggers) can cancel it.
  const passwordLogoutTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (passwordLogoutTimerRef.current) {
        clearTimeout(passwordLogoutTimerRef.current);
        passwordLogoutTimerRef.current = null;
      }
    };
  }, []);

  const [userInfoError, setUserInfoError] = useState("");

  const fetchUserInfo = useCallback(async () => {
    try {
      const res = await graphqlClient.query(ME_QUERY).toPromise();
      // urql resolves rather than rejects, so without this a failed read left
      // userInfo null and the account card simply vanished.
      if (res.error) throw new Error(res.error.message);
      if (res.data?.me) {
        setUserInfo(res.data.me);
        setUserInfoError("");
      }
    } catch (err) {
      console.error("Error fetching user info:", err);
      setUserInfoError(err.message || "Could not load your account details");
    }
  }, []);

  useEffect(() => {
    fetchUserInfo();
  }, [fetchUserInfo]);

  const handleUsernameSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setUsernameError("");
      setUsernameSuccess("");
      setUsernameLoading(true);

      if (newUsername.trim().length < 3) {
        setUsernameError("Username must be at least 3 characters long");
        setUsernameLoading(false);
        return;
      }

      if (newUsername.trim() === username) {
        setUsernameError("New username must be different from current username");
        setUsernameLoading(false);
        return;
      }

      try {
        // A successful username change returns a NEW token that
        // onUsernameUpdate installs into auth state, localStorage and axios.
        // Capture the session generation first: if a logout/login happened
        // while this was in flight, that token belongs to a dead session and
        // installing it would hand the new account the old account's token.
        const generation = getSessionGeneration();

        const result = await graphqlClient
          .mutation(UPDATE_USERNAME_MUTATION, {
            input: { newUsername: newUsername.trim(), password: usernamePassword },
          })
          .toPromise();

        if (isSessionStale(generation)) return;

        if (!result.error && result.data?.updateUsername?.success) {
          const data = result.data.updateUsername;
          setUsernameSuccess("Username updated successfully!");
          setNewUsername("");
          setUsernamePassword("");
          if (data.token) {
            if (onUsernameUpdate) {
              onUsernameUpdate(data.username, data.token);
            }
          } else {
            if (onUsernameUpdate) {
              onUsernameUpdate(data.username);
            }
          }
          await fetchUserInfo();
        } else {
          setUsernameError(
            result.error?.message ||
              result.data?.updateUsername?.message ||
              "Failed to update username"
          );
        }
      } catch (err) {
        setUsernameError(err.message || "Failed to update username. Please try again.");
      } finally {
        setUsernameLoading(false);
      }
    },
    [newUsername, usernamePassword, username, onUsernameUpdate, fetchUserInfo]
  );

  const handlePasswordSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setPasswordError("");
      setPasswordSuccess("");
      setPasswordLoading(true);

      if (newPassword !== confirmPassword) {
        setPasswordError("New passwords do not match");
        setPasswordLoading(false);
        return;
      }

      if (newPassword.length < 6) {
        setPasswordError("New password must be at least 6 characters long");
        setPasswordLoading(false);
        return;
      }

      // Captured BEFORE the mutation is issued. If this session ends (or is
      // replaced by a new login) while the request is in flight, reading the
      // generation afterwards would return the *new* session's value and the
      // staleness guard below would pass — logging the replacement user out.
      const generation = getSessionGeneration();

      try {
        // Always require current password
        if (!currentPassword) {
          setPasswordError("Current password is required");
          setPasswordLoading(false);
          return;
        }

        const result = await graphqlClient
          .mutation(UPDATE_PASSWORD_MUTATION, {
            input: { currentPassword, newPassword },
          })
          .toPromise();

        // Dead session: do not write its state or schedule its logout.
        if (isSessionStale(generation)) return;

        if (!result.error && result.data?.updatePassword?.success) {
          setPasswordSuccess("Password updated successfully! Please log in again.");
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
          // The password change superseded this session's token (server
          // token-version bump), so skip any further authenticated calls;
          // onPasswordUpdateSuccess ends the session and returns to login.
          if (onPasswordUpdateSuccess) {
            if (passwordLogoutTimerRef.current) {
              clearTimeout(passwordLogoutTimerRef.current);
            }
            passwordLogoutTimerRef.current = setTimeout(() => {
              passwordLogoutTimerRef.current = null;
              // Someone logged out (or logged back in) during the delay: this
              // timer belongs to a dead session and must not end the live one.
              if (isSessionStale(generation)) return;
              onPasswordUpdateSuccess();
            }, 1500);
          }
        } else {
          setPasswordError(
            result.error?.message ||
              result.data?.updatePassword?.message ||
              "Failed to update password"
          );
        }
      } catch (err) {
        setPasswordError(
          err.response?.data?.error || "Failed to update password. Please try again."
        );
      } finally {
        setPasswordLoading(false);
      }
    },
    [newPassword, confirmPassword, currentPassword, onPasswordUpdateSuccess]
  );

  return {
    userInfo,
    userInfoError,
    fetchUserInfo,
    newUsername,
    setNewUsername,
    usernamePassword,
    setUsernamePassword,
    usernameError,
    usernameSuccess,
    usernameLoading,
    handleUsernameSubmit,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    passwordError,
    passwordSuccess,
    passwordLoading,
    handlePasswordSubmit,
  };
}

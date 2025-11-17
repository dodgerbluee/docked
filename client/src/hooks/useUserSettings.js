import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";

/**
 * useUserSettings Hook
 * Manages user information, username, and password updates
 */
export function useUserSettings({
  username,
  onUsernameUpdate,
  onPasswordUpdateSuccess,
  isFirstLogin = false,
}) {
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

  const fetchUserInfo = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/auth/me`);
      if (response.data.success) {
        setUserInfo(response.data.user);
      }
    } catch (err) {
      console.error("Error fetching user info:", err);
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
        const response = await axios.post(`${API_BASE_URL}/api/auth/update-username`, {
          newUsername: newUsername.trim(),
          password: usernamePassword,
        });

        if (response.data.success) {
          setUsernameSuccess("Username updated successfully!");
          setNewUsername("");
          setUsernamePassword("");
          if (response.data.token) {
            if (onUsernameUpdate) {
              onUsernameUpdate(response.data.newUsername, response.data.token);
            }
          } else {
            if (onUsernameUpdate) {
              onUsernameUpdate(response.data.newUsername);
            }
          }
          await fetchUserInfo();
        } else {
          setUsernameError(response.data.error || "Failed to update username");
        }
      } catch (err) {
        setUsernameError(
          err.response?.data?.error || "Failed to update username. Please try again."
        );
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

      try {
        // For first login, don't send currentPassword since it's optional
        const requestBody = isFirstLogin ? { newPassword } : { currentPassword, newPassword };

        const response = await axios.post(`${API_BASE_URL}/api/auth/update-password`, requestBody);

        if (response.data.success) {
          setPasswordSuccess("Password updated successfully!");
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
          await fetchUserInfo();
          if (isFirstLogin && onPasswordUpdateSuccess) {
            setTimeout(() => {
              onPasswordUpdateSuccess();
            }, 1500);
          }
        } else {
          setPasswordError(response.data.error || "Failed to update password");
        }
      } catch (err) {
        setPasswordError(
          err.response?.data?.error || "Failed to update password. Please try again."
        );
      } finally {
        setPasswordLoading(false);
      }
    },
    [
      newPassword,
      confirmPassword,
      currentPassword,
      isFirstLogin,
      onPasswordUpdateSuccess,
      fetchUserInfo,
    ]
  );

  return {
    userInfo,
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

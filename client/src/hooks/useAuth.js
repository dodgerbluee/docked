import { useState, useCallback, useRef, useEffect } from "react";
import axios from "axios";
import { authApi } from "../services/apiClient";
import { AuthenticationError, getErrorMessage } from "../domain/errors";
import config from "../config";

/**
 * Helper function to validate if a token is valid
 * Returns true if token is a non-empty string that's not "undefined" or "null"
 */
const isValidToken = (token) => {
  return token && 
         typeof token === 'string' && 
         token.trim().length > 0 && 
         token !== 'undefined' && 
         token !== 'null';
};

/**
 * Custom hook for authentication state and operations
 */
export const useAuth = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const token = localStorage.getItem(config.storage.authToken);
    return isValidToken(token);
  });
  const [authToken, setAuthToken] = useState(() => {
    const token = localStorage.getItem(config.storage.authToken);
    if (isValidToken(token)) {
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
      return token;
    }
    // Clear invalid token from localStorage
    if (token && !isValidToken(token)) {
      localStorage.removeItem(config.storage.authToken);
    }
    return null;
  });
  const [username, setUsername] = useState(() => {
    return localStorage.getItem(config.storage.username) || null;
  });
  const [userRole, setUserRole] = useState(() => {
    return localStorage.getItem(config.storage.userRole) || "Administrator";
  });
  const [passwordChanged, setPasswordChanged] = useState(() => {
    const stored = localStorage.getItem(config.storage.passwordChanged);
    if (stored === null && localStorage.getItem(config.storage.authToken)) {
      return false;
    }
    return stored === "true";
  });

  const logoutInProgressRef = useRef(false);
  const handleLogoutRef = useRef(null);

  // Handle login
  const handleLogin = useCallback((token, user, pwdChanged) => {
    if (!isValidToken(token)) {
      console.error("Invalid token received during login");
      return;
    }
    axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    setAuthToken(token);
    setUsername(user);
    setPasswordChanged(pwdChanged);
    setIsAuthenticated(true);
  }, []);

  // Handle username update
  const handleUsernameUpdate = useCallback(async (newUsername, password) => {
    try {
      const response = await authApi.updateUsername(newUsername, password);
      
      if (response.success && response.token) {
        const newToken = response.token;
        if (isValidToken(newToken)) {
          setUsername(newUsername);
          setAuthToken(newToken);
          localStorage.setItem(config.storage.username, newUsername);
          localStorage.setItem(config.storage.authToken, newToken);
          axios.defaults.headers.common["Authorization"] = `Bearer ${newToken}`;
        } else {
          throw new Error("Invalid token received from server");
        }
      } else {
        throw new Error(response.error || "Failed to update username");
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error, "Failed to update username");
      throw new Error(errorMessage);
    }
  }, []);

  // Handle password update
  const handlePasswordUpdate = useCallback(async (currentPassword, newPassword) => {
    try {
      const response = await authApi.updatePassword(currentPassword, newPassword);
      
      if (response.success) {
        setPasswordChanged(true);
        localStorage.setItem(config.storage.passwordChanged, "true");
        return { success: true };
      } else {
        throw new Error(response.error || "Failed to update password");
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error, "Failed to update password");
      return { success: false, error: errorMessage };
    }
  }, []);
  
  // Handle password update success (for backward compatibility)
  const handlePasswordUpdateSuccess = useCallback(() => {
    setPasswordChanged(true);
    localStorage.setItem(config.storage.passwordChanged, "true");
  }, []);

  // Handle logout
  const handleLogout = useCallback(() => {
    localStorage.removeItem(config.storage.authToken);
    localStorage.removeItem(config.storage.username);
    localStorage.removeItem(config.storage.passwordChanged);
    localStorage.removeItem(config.storage.userRole);
    setAuthToken(null);
    setUsername(null);
    setUserRole("Administrator");
    setPasswordChanged(false);
    setIsAuthenticated(false);
    delete axios.defaults.headers.common["Authorization"];
  }, []);

  // Keep ref updated with latest logout function
  useEffect(() => {
    handleLogoutRef.current = handleLogout;
  }, [handleLogout]);

  // Configure axios to include auth token in all requests
  useEffect(() => {
    if (isValidToken(authToken) && isAuthenticated) {
      axios.defaults.headers.common["Authorization"] = `Bearer ${authToken}`;
    } else {
      delete axios.defaults.headers.common["Authorization"];
    }
  }, [authToken, isAuthenticated]);

  // Set up axios interceptor to handle 401 errors globally
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (
          error.response?.status === 401 &&
          !error.config?.url?.includes("/api/auth/login") &&
          !logoutInProgressRef.current &&
          handleLogoutRef.current
        ) {
          console.warn("Authentication token invalid, logging out...");
          logoutInProgressRef.current = true;
          handleLogoutRef.current();
          setTimeout(() => {
            logoutInProgressRef.current = false;
          }, 1000);
        }
        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.response.eject(interceptor);
    };
  }, []);

  return {
    isAuthenticated,
    authToken,
    username,
    userRole,
    passwordChanged,
    handleLogin,
    handleUsernameUpdate,
    handlePasswordUpdate,
    handlePasswordUpdateSuccess,
    handleLogout,
    logoutInProgressRef,
    handleLogoutRef,
  };
};


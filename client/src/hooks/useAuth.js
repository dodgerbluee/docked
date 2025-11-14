import { useState, useCallback, useRef, useEffect } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

/**
 * Custom hook for authentication state and operations
 */
export const useAuth = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return !!localStorage.getItem("authToken");
  });
  const [authToken, setAuthToken] = useState(() => {
    const token = localStorage.getItem("authToken");
    if (token) {
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    }
    return token || null;
  });
  const [username, setUsername] = useState(() => {
    return localStorage.getItem("username") || null;
  });
  const [userRole, setUserRole] = useState(() => {
    return localStorage.getItem("userRole") || "Administrator";
  });
  const [passwordChanged, setPasswordChanged] = useState(() => {
    const stored = localStorage.getItem("passwordChanged");
    if (stored === null && localStorage.getItem("authToken")) {
      return false;
    }
    return stored === "true";
  });

  const logoutInProgressRef = useRef(false);
  const handleLogoutRef = useRef(null);

  // Handle login
  const handleLogin = useCallback((token, user, pwdChanged) => {
    axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    setAuthToken(token);
    setUsername(user);
    setPasswordChanged(pwdChanged);
    setIsAuthenticated(true);
  }, []);

  // Handle username update
  const handleUsernameUpdate = useCallback((newUsername, newToken = null) => {
    setUsername(newUsername);
    localStorage.setItem("username", newUsername);
    if (newToken) {
      setAuthToken(newToken);
      localStorage.setItem("authToken", newToken);
      axios.defaults.headers.common["Authorization"] = `Bearer ${newToken}`;
    } else {
      const token = Buffer.from(`${newUsername}:${Date.now()}`).toString("base64");
      setAuthToken(token);
      localStorage.setItem("authToken", token);
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    }
  }, []);

  // Handle password update success
  const handlePasswordUpdateSuccess = useCallback(() => {
    setPasswordChanged(true);
    localStorage.setItem("passwordChanged", "true");
  }, []);

  // Handle logout
  const handleLogout = useCallback(() => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("username");
    localStorage.removeItem("passwordChanged");
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
    if (authToken && isAuthenticated) {
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
    handlePasswordUpdateSuccess,
    handleLogout,
    logoutInProgressRef,
    handleLogoutRef,
  };
};


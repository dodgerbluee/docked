import { useState, useCallback, useRef, useEffect } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";

/**
 * Custom hook for authentication state and operations
 */
export const useAuth = () => {
  // Start with true if token exists - trust localStorage initially for better UX
  // Token will be validated in background, and backend validates all requests
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return !!localStorage.getItem("authToken");
  });
  const [isValidating, setIsValidating] = useState(true);
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
  const [instanceAdmin, setInstanceAdmin] = useState(() => {
    const stored = localStorage.getItem("instanceAdmin");
    // Default to false if not set, but check localStorage first
    if (stored === null) {
      return false;
    }
    return stored === "true";
  });

  const logoutInProgressRef = useRef(false);
  const handleLogoutRef = useRef(null);

  // Handle logout - defined early so it can be used in validation
  const handleLogout = useCallback(() => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("username");
    localStorage.removeItem("userRole");
    localStorage.removeItem("instanceAdmin");
    setAuthToken(null);
    setUsername(null);
    setUserRole("Administrator");
    setInstanceAdmin(false);
    setIsAuthenticated(false);
    delete axios.defaults.headers.common["Authorization"];
  }, []);

  // Validate token on mount
  useEffect(() => {
    const validateToken = async () => {
      const token = localStorage.getItem("authToken");

      if (!token) {
        setIsValidating(false);
        setIsAuthenticated(false);
        return;
      }

      try {
        const response = await axios.get(`${API_BASE_URL}/api/auth/verify`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.data.success) {
          // Token is valid - user exists in database
          setIsAuthenticated(true);
          if (response.data.username) {
            setUsername(response.data.username);
            localStorage.setItem("username", response.data.username);
          }
          if (response.data.role) {
            setUserRole(response.data.role);
            localStorage.setItem("userRole", response.data.role);
          }
          if (response.data.instanceAdmin !== undefined) {
            setInstanceAdmin(response.data.instanceAdmin);
            localStorage.setItem("instanceAdmin", response.data.instanceAdmin ? "true" : "false");
          }
        } else {
          // Token invalid - clear storage
          handleLogout();
        }
      } catch (error) {
        // Only clear on 401 (unauthorized) - network errors shouldn't log out
        // If it's a 401, the token is actually invalid
        if (error.response?.status === 401) {
          console.warn("Token validation failed - unauthorized:", error.response?.status);
          handleLogout();
        } else {
          // Network error or other issue - keep user logged in, just log the error
          // The backend will validate the token on actual API calls, and the axios
          // interceptor will catch 401s and log out if the token is truly invalid
          console.warn("Token validation error (non-fatal, keeping session):", error.message);
          // Keep isAuthenticated as true since we have a token in localStorage
          // The user can still use the app, validation will retry on next refresh
        }
      } finally {
        setIsValidating(false);
      }
    };

    validateToken();
  }, [handleLogout]);

  // Handle login
  const handleLogin = useCallback((token, user, role, isInstanceAdmin = false) => {
    axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    setAuthToken(token);
    setUsername(user);
    if (role) {
      setUserRole(role);
      localStorage.setItem("userRole", role);
    }
    setInstanceAdmin(isInstanceAdmin);
    localStorage.setItem("instanceAdmin", isInstanceAdmin ? "true" : "false");
    setIsAuthenticated(true);
    setIsValidating(false);
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
      const token = btoa(`${newUsername}:${Date.now()}`);
      setAuthToken(token);
      localStorage.setItem("authToken", token);
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    }
  }, []);

  // Handle password update success (no-op, kept for backward compatibility)
  const handlePasswordUpdateSuccess = useCallback(() => {
    // Password update success - no special handling needed
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
          !error.config?.url?.includes("/api/auth/verify") &&
          !error.config?.url?.includes("/api/version") &&
          !error.config?.url?.includes("/api/portainer/instances/validate") &&
          !error.config?.url?.includes("/api/discord/test") &&
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
    instanceAdmin,
    isValidating,
    handleLogin,
    handleUsernameUpdate,
    handlePasswordUpdateSuccess,
    handleLogout,
    logoutInProgressRef,
    handleLogoutRef,
  };
};

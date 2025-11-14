import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

/**
 * Custom hook for theme/color scheme management
 * Handles color scheme preference (system/light/dark) and dark mode state
 */
export const useTheme = (isAuthenticated, authToken) => {
  const [colorScheme, setColorScheme] = useState("system"); // 'system', 'light', or 'dark'
  const [darkMode, setDarkMode] = useState(() => {
    // Initial dark mode based on system preference
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  // Fetch color scheme from API
  const fetchColorScheme = useCallback(async () => {
    if (!isAuthenticated || !authToken) return;
    try {
      const response = await axios.get(`${API_BASE_URL}/api/settings/color-scheme`);
      if (response.data.success) {
        setColorScheme(response.data.colorScheme || "system");
      }
    } catch (err) {
      console.error("Error fetching color scheme:", err);
      // Fallback to localStorage if API fails (for backward compatibility during migration)
      const saved = localStorage.getItem("colorScheme");
      if (saved) {
        setColorScheme(saved);
      }
    }
  }, [isAuthenticated, authToken]);

  // Handle color scheme preference change from Settings
  const handleColorSchemeChange = useCallback(async (newColorScheme) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/api/settings/color-scheme`, {
        colorScheme: newColorScheme,
      });
      if (response.data.success) {
        setColorScheme(newColorScheme);
        // Remove from localStorage since we're now using DB
        localStorage.removeItem("colorScheme");
      }
    } catch (err) {
      console.error("Error saving color scheme:", err);
      // Fallback to localStorage if API fails (for backward compatibility)
      setColorScheme(newColorScheme);
      localStorage.setItem("colorScheme", newColorScheme);
    }
  }, []);

  // Handle temporary theme toggle from avatar dropdown (doesn't persist)
  const handleTemporaryThemeToggle = useCallback(() => {
    setDarkMode((prev) => !prev);
  }, []);

  // Update dark mode based on color scheme preference
  useEffect(() => {
    if (colorScheme === "system") {
      // Listen to system preference changes
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = (e) => {
        setDarkMode(e.matches);
      };

      // Set initial value
      setDarkMode(mediaQuery.matches);

      // Listen for changes
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", handleChange);
        return () => mediaQuery.removeEventListener("change", handleChange);
      } else {
        // Fallback for older browsers
        mediaQuery.addListener(handleChange);
        return () => mediaQuery.removeListener(handleChange);
      }
    } else {
      // Use explicit preference
      setDarkMode(colorScheme === "dark");
    }
  }, [colorScheme]);

  // Update body class when dark mode changes
  useEffect(() => {
    if (darkMode) {
      document.body.classList.add("dark-mode");
    } else {
      document.body.classList.remove("dark-mode");
    }
  }, [darkMode]);

  return {
    colorScheme,
    darkMode,
    fetchColorScheme,
    handleColorSchemeChange,
    handleTemporaryThemeToggle,
  };
};


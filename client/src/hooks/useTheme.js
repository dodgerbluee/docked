import { useState, useEffect, useCallback } from "react";
import { graphqlClient } from "../graphql/client";
import { USER_PREFERENCES_QUERY } from "../graphql/queries";
import { getSessionGeneration, isSessionStale } from "../utils/cacheRegistry";

/**
 * Custom hook for theme/color scheme management
 * Handles color scheme preference (system/light/dark) and dark mode state
 */
export const useTheme = (isAuthenticated, authToken) => {
  const [colorScheme, setColorScheme] = useState("system"); // 'system', 'light', or 'dark'
  // Set when the stored preference could not be read, so the fallback in use is
  // not mistaken for the user's actual choice.
  const [colorSchemeError, setColorSchemeError] = useState("");
  const [darkMode, setDarkMode] = useState(() => {
    // Check localStorage first for saved dark mode state
    try {
      const saved = localStorage.getItem("darkMode");
      if (saved === "true" || saved === "false") {
        return saved === "true";
      }
    } catch {
      // Ignore localStorage errors
    }
    // Fallback to system preference
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  // Fetch color scheme from GraphQL
  const fetchColorScheme = useCallback(async () => {
    if (!isAuthenticated || !authToken) return;
    // The response may land after logout, when this hook's session is already
    // dead and a new identity is showing. Its preference belongs to the old
    // user and must not repaint the new session.
    const generation = getSessionGeneration();
    try {
      const res = await graphqlClient
        .query(USER_PREFERENCES_QUERY, undefined, { requestPolicy: "network-only" })
        .toPromise();
      if (isSessionStale(generation)) return;
      // urql resolves rather than rejects, so without this a failed read would
      // look like "no preferences" and the form would carry a fallback theme
      // that a later save writes back over the stored one.
      if (res.error) throw res.error;
      if (res.data?.userPreferences) {
        setColorScheme(res.data.userPreferences.colorScheme || "system");
      }
      setColorSchemeError("");
    } catch (err) {
      console.error("Error fetching color scheme:", err);
      if (isSessionStale(generation)) return;
      setColorSchemeError(err.message || "Could not load your colour scheme");
      // Fallback to localStorage if API fails (for backward compatibility during migration)
      const saved = localStorage.getItem("colorScheme");
      if (saved) {
        setColorScheme(saved);
      }
    }
  }, [isAuthenticated, authToken]);

  // Handle color scheme preference change from Settings
  // Note: This is called AFTER the API call in handleSaveGeneralSettings, so we just update the state
  const handleColorSchemeChange = useCallback((newColorScheme) => {
    // Update immediately for instant UI feedback (API call already happened in handleSaveGeneralSettings)
    setColorScheme(newColorScheme);
    // Remove from localStorage since we're now using DB
    localStorage.removeItem("colorScheme");
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

  // Update body class and theme-color meta tag when dark mode changes, persist to localStorage
  useEffect(() => {
    if (darkMode) {
      document.body.classList.add("dark-mode");
    } else {
      document.body.classList.remove("dark-mode");
    }

    // Update theme-color meta tag for mobile status bar
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute("content", darkMode ? "#1a1a2e" : "#005a9c");
    }

    // Persist dark mode state to localStorage for immediate application on page load
    try {
      localStorage.setItem("darkMode", darkMode.toString());
    } catch {
      // Silently fail if localStorage is not available
    }
  }, [darkMode]);

  return {
    colorScheme,
    colorSchemeError,
    darkMode,
    fetchColorScheme,
    handleColorSchemeChange,
    handleTemporaryThemeToggle,
  };
};

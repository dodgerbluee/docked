import { useState, useEffect } from "react";

/**
 * useMediaQuery Hook
 * Reactive media query matching that updates on viewport changes (resize, rotation).
 * Replaces one-shot window.matchMedia checks throughout the codebase.
 *
 * @param {string} query - CSS media query string, e.g. "(max-width: 768px)"
 * @returns {boolean} - Whether the media query currently matches
 */
export const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia(query).matches;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQueryList = window.matchMedia(query);
    setMatches(mediaQueryList.matches);

    const handleChange = (event) => {
      setMatches(event.matches);
    };

    // Modern browsers
    if (mediaQueryList.addEventListener) {
      mediaQueryList.addEventListener("change", handleChange);
      return () => mediaQueryList.removeEventListener("change", handleChange);
    }
    // Safari <14 fallback
    mediaQueryList.addListener(handleChange);
    return () => mediaQueryList.removeListener(handleChange);
  }, [query]);

  return matches;
};

import { useMediaQuery } from "./useMediaQuery";

/**
 * useIsMobile Hook
 * Convenience wrapper for the most common responsive check.
 * Returns true when viewport is <= 768px (the primary mobile breakpoint).
 *
 * @returns {boolean} - Whether the viewport is mobile-sized
 */
export const useIsMobile = () => {
  return useMediaQuery("(max-width: 768px)");
};

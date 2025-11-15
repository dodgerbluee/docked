import { useNavigate } from "react-router-dom";
import { useMemo } from "react";

/**
 * Custom hook for router-aware navigation handlers
 * Wraps navigation handlers to navigate to home route before executing
 *
 * @param {Object} handlers - Object containing navigation handler functions
 * @returns {Object} Wrapped navigation handlers that navigate to "/" first
 *
 * @example
 * const handlers = useRouterNavigation({
 *   onNavigateToSummary: handleNavigateToSummary,
 *   onNavigateToSettings: handleNavigateToSettings,
 * });
 */
export const useRouterNavigation = (handlers) => {
  const navigate = useNavigate();

  return useMemo(() => {
    const result = {};

    Object.keys(handlers).forEach((key) => {
      const originalHandler = handlers[key];

      if (typeof originalHandler === "function") {
        result[key] = (...args) => {
          navigate("/");
          originalHandler(...args);
        };
      } else {
        result[key] = originalHandler;
      }
    });

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, ...Object.values(handlers)]);
};

/**
 * Hook for managing Containers page content tabs
 */

import { useState, useCallback } from "react";
import { CONTAINERS_CONTENT_TABS } from "../../../constants/containersPage";

/**
 * Hook to manage content tab state (controlled or uncontrolled)
 * @param {Object} options
 * @param {string} options.controlledContentTab - Controlled tab value
 * @param {Function} options.onSetContentTab - Controlled tab setter
 * @returns {Object} Tab state and setter
 */
export const useContainersTabs = ({ controlledContentTab, onSetContentTab }) => {
  const [internalContentTab, setInternalContentTab] = useState(CONTAINERS_CONTENT_TABS.UPDATES);
  const isContentTabControlled = onSetContentTab !== undefined;
  const contentTab = isContentTabControlled
    ? controlledContentTab !== undefined
      ? controlledContentTab
      : CONTAINERS_CONTENT_TABS.UPDATES
    : internalContentTab;

  const setContentTab = useCallback(
    (value) => {
      if (isContentTabControlled) {
        // If controlled, call the parent's setter
        onSetContentTab(value);
      } else {
        // If uncontrolled, use internal state
        if (typeof value === "function") {
          setInternalContentTab(value);
        } else {
          setInternalContentTab(value);
        }
      }
    },
    [isContentTabControlled, onSetContentTab]
  );

  return {
    contentTab,
    setContentTab,
  };
};

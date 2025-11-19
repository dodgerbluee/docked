import { useState, useCallback } from "react";

/**
 * useMenuState Hook
 * Manages avatar and notification menu state with mutual exclusivity
 */
export function useMenuState() {
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const [showNotificationMenu, setShowNotificationMenu] = useState(false);

  const toggleAvatarMenu = useCallback((show) => {
    if (show !== undefined) {
      setShowAvatarMenu(show);
      if (show) setShowNotificationMenu(false);
    } else {
      setShowAvatarMenu((prev) => {
        if (!prev) setShowNotificationMenu(false);
        return !prev;
      });
    }
  }, []);

  const toggleNotificationMenu = useCallback((show) => {
    if (show !== undefined) {
      setShowNotificationMenu(show);
      if (show) setShowAvatarMenu(false);
    } else {
      setShowNotificationMenu((prev) => {
        if (!prev) setShowAvatarMenu(false);
        return !prev;
      });
    }
  }, []);

  const closeAllMenus = useCallback(() => {
    setShowAvatarMenu(false);
    setShowNotificationMenu(false);
  }, []);

  return {
    showAvatarMenu,
    showNotificationMenu,
    setShowAvatarMenu,
    setShowNotificationMenu,
    toggleAvatarMenu,
    toggleNotificationMenu,
    closeAllMenus,
  };
}

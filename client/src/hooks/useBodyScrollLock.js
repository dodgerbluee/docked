import { useEffect, useRef } from "react";

/**
 * useBodyScrollLock Hook
 * Locks/unlocks body scrolling when active.
 * Compensates for scrollbar width to prevent layout shift.
 * Used by MobileDrawer, Modal, and any overlay that needs scroll locking.
 *
 * @param {boolean} isLocked - Whether body scroll should be locked
 */
export const useBodyScrollLock = (isLocked) => {
  const scrollbarWidthRef = useRef(0);

  useEffect(() => {
    if (!isLocked) {
      // Restore body scroll
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
      return;
    }

    // Calculate scrollbar width to prevent layout shift
    scrollbarWidthRef.current = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    if (scrollbarWidthRef.current > 0) {
      document.body.style.paddingRight = `${scrollbarWidthRef.current}px`;
    }

    return () => {
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
    };
  }, [isLocked]);
};

import { useEffect } from "react";
import { lockScroll, unlockScroll } from "../utils/scrollLock";

/**
 * useBodyScrollLock Hook
 * Locks/unlocks body scrolling when active.
 * Uses shared ref-counted scrollLock utility so multiple overlays cooperate.
 *
 * @param {boolean} isLocked - Whether body scroll should be locked
 */
export const useBodyScrollLock = (isLocked) => {
  useEffect(() => {
    if (!isLocked) return;
    lockScroll();
    return () => unlockScroll();
  }, [isLocked]);
};

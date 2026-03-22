/**
 * Shared scroll lock utility with reference counting.
 *
 * Multiple overlays (Modal, ContainerDebugModal, MobileDrawer) may request
 * body scroll lock simultaneously. Without ref-counting, the first overlay
 * to close would prematurely restore scrolling while another overlay is
 * still open.
 *
 * Usage:
 *   lockScroll()   — call when an overlay opens
 *   unlockScroll() — call when an overlay closes / unmounts
 */

let lockCount = 0;

export function lockScroll() {
  lockCount++;
  if (lockCount === 1) {
    // First lock — calculate scrollbar width to prevent layout shift
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
  }
}

export function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  }
}

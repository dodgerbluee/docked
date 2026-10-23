import React, { useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { X } from "lucide-react";
import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";
import { useDialogSemantics } from "../../hooks/useDialogSemantics";
import styles from "./MobileDrawer.module.css";

/**
 * MobileDrawer Component
 * Shared slide-out drawer for mobile sidebar content.
 * Replaces the duplicated drawer patterns in ContainersPage and TrackedAppsPage.
 *
 * Features:
 * - Slide-in animation from left or right
 * - Overlay backdrop with tap-to-close
 * - Escape key dismissal
 * - Body scroll locking (with scrollbar compensation)
 * - Focus trap for accessibility
 * - ARIA attributes (role="dialog", aria-modal, aria-label)
 * - Safe area inset support
 * - prefers-reduced-motion respected via CSS
 */
const MobileDrawer = React.memo(function MobileDrawer({
  isOpen,
  onClose,
  title,
  children,
  side = "left",
  width,
  ariaLabel,
  className = "",
}) {
  const drawerRef = useRef(null);

  // Lock body scroll when drawer is open
  useBodyScrollLock(isOpen);

  // Focus in, Tab trap and Escape come from the same place the shared Modal
  // gets them, so a dialog opened on top of the drawer owns the keyboard
  // instead of both closing on one Escape.
  useDialogSemantics(drawerRef, { isOpen, onClose });

  if (!isOpen) return null;

  const sideClass = side === "right" ? styles.right : styles.left;
  const drawerStyle = width ? { width, maxWidth: "85vw" } : {};

  const drawerContent = (
    <div className={styles.wrapper}>
      {/* Overlay */}
      <div
        className={`${styles.overlay} ${isOpen ? styles.overlayVisible : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        className={`${styles.drawer} ${sideClass} ${isOpen ? styles.drawerOpen : ""} ${className}`}
        style={drawerStyle}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title || "Navigation drawer"}
        tabIndex={-1}
      >
        {/* Drawer header */}
        {title && (
          <div className={styles.header}>
            <h3 className={styles.title}>{title}</h3>
            <button className={styles.closeButton} onClick={onClose} aria-label="Close drawer">
              <X size={20} />
            </button>
          </div>
        )}

        {/* Drawer content */}
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );

  return createPortal(drawerContent, document.body);
});

MobileDrawer.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string,
  children: PropTypes.node.isRequired,
  side: PropTypes.oneOf(["left", "right"]),
  width: PropTypes.string,
  ariaLabel: PropTypes.string,
  className: PropTypes.string,
};

export default MobileDrawer;

import React, { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { X } from "lucide-react";
import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";
import styles from "./MobileDrawer.module.css";

/**
 * MobileDrawer Component
 * Shared slide-out drawer for mobile sidebar content.
 * Replaces the duplicated drawer patterns in PortainerPage and TrackedAppsPage.
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
  const previousFocusRef = useRef(null);

  // Lock body scroll when drawer is open
  useBodyScrollLock(isOpen);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement;
      // Focus the drawer after animation starts
      requestAnimationFrame(() => {
        if (drawerRef.current) {
          const firstFocusable = drawerRef.current.querySelector(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (firstFocusable) {
            firstFocusable.focus();
          } else {
            drawerRef.current.focus();
          }
        }
      });
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen]);

  // Focus trap
  const handleKeyDown = useCallback((e) => {
    if (e.key !== "Tab" || !drawerRef.current) return;

    const focusableElements = drawerRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement?.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement?.focus();
    }
  }, []);

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
        onKeyDown={handleKeyDown}
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

import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { X } from "lucide-react";
import Button from "./Button";
import styles from "./Modal.module.css";

/**
 * Modal Component
 * Reusable modal dialog component
 */
const Modal = React.memo(function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
  showCloseButton = true,
  className = "",
  ...props
}) {
  const mouseDownTargetRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  const handleOverlayClick = (e) => {
    // Only close if clicking directly on the overlay (not on modal content)
    if (e.target !== e.currentTarget) {
      return;
    }

    // Check if there's an active text selection
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }

    // Check if the click target is within an input/textarea element
    const clickTarget = e.target;
    if (
      clickTarget &&
      (clickTarget.tagName === "INPUT" ||
        clickTarget.tagName === "TEXTAREA" ||
        clickTarget.isContentEditable ||
        clickTarget.closest("input") ||
        clickTarget.closest("textarea") ||
        clickTarget.closest("[contenteditable]"))
    ) {
      return;
    }

    // Check if the click originated from an input/textarea element (activeElement)
    const activeElement = document.activeElement;
    if (
      activeElement &&
      (activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        activeElement.isContentEditable)
    ) {
      return;
    }

    // Check if mousedown happened on an input/textarea and mouseup happened outside
    if (
      mouseDownTargetRef.current &&
      (mouseDownTargetRef.current.tagName === "INPUT" ||
        mouseDownTargetRef.current.tagName === "TEXTAREA" ||
        mouseDownTargetRef.current.isContentEditable ||
        mouseDownTargetRef.current.closest("input") ||
        mouseDownTargetRef.current.closest("textarea") ||
        mouseDownTargetRef.current.closest("[contenteditable]"))
    ) {
      mouseDownTargetRef.current = null;
      return;
    }

    onClose();
  };

  const handleMouseDown = (e) => {
    // Track the element where mousedown occurred
    mouseDownTargetRef.current = e.target;
  };

  const handleMouseUp = () => {
    // Clear the ref after a short delay to allow click handler to check it
    setTimeout(() => {
      mouseDownTargetRef.current = null;
    }, 0);
  };

  if (!isOpen) return null;

  const sizeClass = size && styles[size] ? styles[size] : styles.md;

  const modalContent = (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      <div
        className={`${styles.modal} ${sizeClass} ${className}`}
        onClick={(e) => e.stopPropagation()}
        {...props}
      >
        {(title || showCloseButton) && (
          <div className={styles.header}>
            {title && <h3 className={styles.title}>{title}</h3>}
            {showCloseButton && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className={styles.closeButton}
                icon={X}
                aria-label="Close"
              />
            )}
          </div>
        )}
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );

  // Render modal using portal to document.body to avoid positioning issues
  return createPortal(modalContent, document.body);
});

Modal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string,
  children: PropTypes.node.isRequired,
  size: PropTypes.oneOf(["sm", "md", "lg", "xl"]),
  showCloseButton: PropTypes.bool,
  className: PropTypes.string,
};

export default Modal;

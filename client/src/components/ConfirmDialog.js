/**
 * ConfirmDialog Component
 * Reusable confirmation dialog to replace window.confirm
 */

import React, { useRef } from "react";
import PropTypes from "prop-types";
import styles from "./ConfirmDialog.module.css";

/**
 * ConfirmDialog component
 * @param {boolean} isOpen - Whether the dialog is open
 * @param {string} title - Dialog title
 * @param {string} message - Confirmation message
 * @param {string} confirmLabel - Label for confirm button (default: "Confirm")
 * @param {string} cancelLabel - Label for cancel button (default: "Cancel")
 * @param {Function} onConfirm - Handler for confirm action
 * @param {Function} onCancel - Handler for cancel action
 */
function ConfirmDialog({
  isOpen,
  title = "Confirm Action",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}) {
  const mouseDownTargetRef = useRef(null);

  const handleOverlayClick = (e) => {
    // Only close if clicking directly on the overlay (not on dialog content)
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

    onCancel();
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

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>{title}</h3>
        </div>
        <div className={styles.content}>
          <p>{message}</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={styles.confirmButton} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

ConfirmDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  title: PropTypes.string,
  message: PropTypes.string.isRequired,
  confirmLabel: PropTypes.string,
  cancelLabel: PropTypes.string,
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

export default ConfirmDialog;

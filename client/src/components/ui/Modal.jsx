import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { X } from "lucide-react";
import Button from "./Button";
import { lockScroll, unlockScroll } from "../../utils/scrollLock";
import styles from "./Modal.module.css";

// Open modals, innermost last. Every instance used to attach its own Escape
// listener to document, so one keypress closed the whole stack at once and
// nested dialogs fought each other for focus. The stack makes Escape and the
// Tab trap belong to the topmost dialog only.
const modalStack = [];

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getFocusable(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.closest('[aria-hidden="true"]')
  );
}

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
  nonBlocking = false,
  fullScreenMobile = false,
  zIndex,
  ...props
}) {
  const mouseDownTargetRef = useRef(null);
  const modalRef = useRef(null);
  const titleId = useId();
  // Callers pass inline arrow functions, so onClose changes identity on every
  // render. The stack entry below must survive those renders, hence the ref.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (isOpen && !nonBlocking) {
      lockScroll();
      return () => unlockScroll();
    }
  }, [isOpen, nonBlocking]);

  useEffect(() => {
    if (!isOpen) return undefined;

    // Identity marker for this open dialog; the stack order is what decides
    // which dialog owns Escape and the Tab trap.
    const entry = {};
    modalStack.push(entry);
    // Where focus was before this dialog opened, so closing puts the user back
    // on the control they came from instead of the top of the page.
    const previouslyFocused = document.activeElement;

    const container = modalRef.current;
    // Prefer the first field to fill in, so a form modal is ready for typing.
    // Otherwise focus the dialog itself: a keyboard user's next Tab then walks
    // the dialog's own controls instead of the page behind the overlay, and a
    // screen reader announces the dialog.
    const field = container?.querySelector(
      'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [contenteditable]'
    );
    const initial = field || container;
    if (initial && typeof initial.focus === "function") {
      initial.focus();
    }

    const handleKey = (e) => {
      // A dialog that is not the topmost one must not react: the one the user
      // is looking at handles the key.
      if (modalStack[modalStack.length - 1] !== entry) return;

      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }

      // Tab trap. Non-blocking modals deliberately leave the page usable, so
      // they must not trap anything.
      if (e.key !== "Tab" || nonBlocking) return;

      const focusable = getFocusable(modalRef.current);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const outside = !modalRef.current?.contains(active);
      // Focus sits on the dialog itself (nothing inside it has been tabbed to
      // yet): Shift+Tab would otherwise walk out of the dialog into the page.
      const atDialogRoot = active === modalRef.current;

      if (e.shiftKey && (active === first || outside || atDialogRoot)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      const index = modalStack.indexOf(entry);
      if (index >= 0) modalStack.splice(index, 1);
      if (
        previouslyFocused &&
        typeof previouslyFocused.focus === "function" &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen, nonBlocking]);

  const handleOverlayClick = (e) => {
    // Only close if clicking directly on the overlay or backdrop (not on modal content)
    // For non-blocking modals, the backdrop div is the target
    // For blocking modals, the overlay itself is the target
    const isClickOnOverlay = e.target === e.currentTarget;
    const isClickOnBackdrop = e.target.classList?.contains(styles.backdrop);
    if (!isClickOnOverlay && !isClickOnBackdrop) {
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

  const overlayClass = [
    styles.overlay,
    nonBlocking && styles.nonBlocking,
    fullScreenMobile && styles.fullScreenMobile,
  ]
    .filter(Boolean)
    .join(" ");

  const overlayStyle = zIndex ? { zIndex } : {};

  const modalContent = (
    <div
      className={overlayClass}
      style={overlayStyle}
      onClick={handleOverlayClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      {/* For non-blocking modals, add a clickable backdrop layer to capture overlay clicks */}
      {nonBlocking && (
        <div
          className={styles.backdrop}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: "auto",
            zIndex: 0,
          }}
          onClick={handleOverlayClick}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
        />
      )}
      <div
        ref={modalRef}
        className={`${styles.modal} ${sizeClass} ${className}`}
        style={nonBlocking ? { position: "relative", zIndex: 1 } : undefined}
        role="dialog"
        aria-modal={!nonBlocking}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        {...props}
      >
        {(title || showCloseButton) && (
          <div className={styles.header}>
            {title && (
              <h3 id={titleId} className={styles.title}>
                {title}
              </h3>
            )}
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
  title: PropTypes.node,
  children: PropTypes.node.isRequired,
  size: PropTypes.oneOf(["sm", "md", "lg", "xl"]),
  showCloseButton: PropTypes.bool,
  className: PropTypes.string,
  nonBlocking: PropTypes.bool,
  fullScreenMobile: PropTypes.bool,
  zIndex: PropTypes.number,
};

export default Modal;

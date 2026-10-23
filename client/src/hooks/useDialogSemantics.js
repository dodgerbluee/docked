import { useEffect, useRef } from "react";

// Every dialog in the app used to own its own Escape/Tab/focus code, so the
// shared Modal closed only its topmost layer while the hand-rolled dialogs
// (operation modals, confirm dialogs, drawers) closed every layer at once and
// never moved focus into themselves. One stack for all of them makes Escape
// and the Tab trap belong to the dialog the user is actually looking at.
const dialogStack = [];

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

// The dialog that owns the keyboard. Usually that is the one opened last, but
// a dialog rendered inside another one is more specific than its ancestor even
// though React runs the child's effect first and registers it earlier.
function topmostEntry() {
  let best = dialogStack[dialogStack.length - 1];
  for (const entry of dialogStack) {
    if (entry !== best && best?.el && entry.el && best.el.contains(entry.el)) {
      best = entry;
    }
  }
  return best;
}

/**
 * Attaches dialog semantics to an element: focus moves in on open and back to
 * the invoking control on close, Tab stays inside, and Escape closes only the
 * topmost open dialog.
 *
 * @param ref        ref on the element carrying role="dialog"
 * @param isOpen     whether the dialog is currently open
 * @param onClose    close handler for this dialog
 * @param nonBlocking dialogs that deliberately leave the page usable; they
 *                   must not trap Tab (Escape still closes them)
 * @param escapeEnabled set false for a dialog that must not be dismissed by
 *                   Escape while it is busy (e.g. a running operation)
 */
export function useDialogSemantics(
  ref,
  { isOpen, onClose, nonBlocking = false, escapeEnabled = true }
) {
  // Callers pass inline arrow functions, so onClose changes identity on every
  // render. The stack entry below must survive those renders, hence the refs.
  const onCloseRef = useRef(onClose);
  const escapeRef = useRef(escapeEnabled);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    escapeRef.current = escapeEnabled;
  }, [escapeEnabled]);

  useEffect(() => {
    if (!isOpen) return undefined;

    // Identity marker for this open dialog; the stack order is what decides
    // which dialog owns Escape and the Tab trap.
    const entry = { el: ref.current };
    dialogStack.push(entry);
    // Where focus was before this dialog opened, so closing puts the user back
    // on the control they came from instead of the top of the page.
    const previouslyFocused = document.activeElement;

    const container = ref.current;
    // Prefer the first field to fill in, so a form dialog is ready for typing.
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
      if (topmostEntry() !== entry) return;

      if (e.key === "Escape") {
        if (escapeRef.current) onCloseRef.current();
        return;
      }

      // Tab trap. Non-blocking dialogs deliberately leave the page usable, so
      // they must not trap anything.
      if (e.key !== "Tab" || nonBlocking) return;

      const focusable = getFocusable(ref.current);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const outside = !ref.current?.contains(active);
      // Focus sits on the dialog itself (nothing inside it has been tabbed to
      // yet): Shift+Tab would otherwise walk out of the dialog into the page.
      const atDialogRoot = active === ref.current;

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
      const index = dialogStack.indexOf(entry);
      if (index >= 0) dialogStack.splice(index, 1);
      if (
        previouslyFocused &&
        typeof previouslyFocused.focus === "function" &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen, nonBlocking, ref]);
}

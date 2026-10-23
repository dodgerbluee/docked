/**
 * Tests for the shared dialog-semantics hook that Modal, the drawer and the
 * hand-rolled operation dialogs all use. The point of the hook is that the
 * behaviour is identical everywhere, so it is asserted once here against the
 * hook itself rather than duplicated per component.
 */
import React, { useRef, useState } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { useDialogSemantics } from "../useDialogSemantics";

function Dialog({ onClose, escapeEnabled = true, label = "Test dialog", children }) {
  const ref = useRef(null);
  useDialogSemantics(ref, { isOpen: true, onClose, escapeEnabled });
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
      {children}
    </div>
  );
}

function Nested({ outerClose, innerClose }) {
  return (
    <>
      <Dialog onClose={outerClose} label="Outer">
        <button type="button">outer button</button>
        <Dialog onClose={innerClose} label="Inner">
          <button type="button">inner button</button>
        </Dialog>
      </Dialog>
    </>
  );
}

beforeEach(() => {
  // Focus left over in jsdom's body from a previous test makes the focus
  // assertions below meaningless.
  document.activeElement?.blur?.();
});

describe("useDialogSemantics", () => {
  it("moves focus into the dialog and back to the trigger when it closes", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && <Dialog onClose={() => setOpen(false)} />}
        </>
      );
    }
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape closes only the topmost dialog", () => {
    const outerClose = () => {};
    const innerClose = vi.fn();
    render(<Nested outerClose={outerClose} innerClose={innerClose} />);

    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(innerClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab inside the dialog", () => {
    render(
      <Dialog onClose={() => {}}>
        <button type="button">first</button>
        <button type="button">last</button>
      </Dialog>
    );

    const last = screen.getByRole("button", { name: "last" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "first" }));

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("ignores Escape for a dialog that is busy", () => {
    const onClose = vi.fn();
    render(
      <Dialog onClose={onClose} escapeEnabled={false}>
        <button type="button">working</button>
      </Dialog>
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

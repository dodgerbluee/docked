/**
 * Dialog-semantics tests for the shared Modal.
 *
 * Every modal in the app is built from this component, so the accessibility
 * contract is fixed here once: the dialog must be announced, keyboard focus
 * must stay inside it while it is open, Escape must close only the dialog the
 * user is looking at, and closing must hand focus back to the control that
 * opened it.
 */
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import Modal from "../ui/Modal";

beforeEach(() => {
  // Focus left over in jsdom's body from a previous test makes the focus
  // assertions below meaningless.
  document.activeElement?.blur?.();
});

describe("Modal dialog semantics", () => {
  it("is announced as a modal dialog labelled by its title", () => {
    render(
      <Modal isOpen onClose={() => {}} title="Delete container">
        <p>body</p>
      </Modal>
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const title = document.getElementById(labelledBy);
    expect(title).not.toBeNull();
    expect(title.textContent).toBe("Delete container");
  });

  it("does not claim modality when it is non-blocking", () => {
    render(
      <Modal isOpen nonBlocking onClose={() => {}} title="Details">
        <p>body</p>
      </Modal>
    );

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "false");
  });

  it("moves focus into the dialog when it opens", () => {
    render(
      <Modal isOpen onClose={() => {}} title="Create user">
        <button type="button">Save</button>
      </Modal>
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("puts the caret in the first field of a form dialog", () => {
    render(
      <Modal isOpen onClose={() => {}} title="Create user">
        <label>
          Username
          <input name="username" />
        </label>
      </Modal>
    );

    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });

  it("wraps Shift+Tab when focus is still on the dialog itself", () => {
    render(
      <Modal isOpen onClose={() => {}} title="Create user">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Modal>
    );

    const dialog = screen.getByRole("dialog");
    dialog.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    const buttons = screen.getAllByRole("button");
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it("keeps Tab inside the dialog", () => {
    render(
      <Modal isOpen onClose={() => {}} title="Create user">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Modal>
    );

    const buttons = screen.getAllByRole("button");
    const last = buttons[buttons.length - 1];
    last.focus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("leaves the page reachable when the modal is non-blocking", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    render(
      <Modal isOpen nonBlocking onClose={() => {}} title="Details">
        <button type="button">Inside</button>
      </Modal>
    );

    const inside = screen.getByRole("button", { name: "Inside" });
    inside.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(inside);

    outside.remove();
  });

  it("closes only the topmost dialog on Escape", () => {
    function Stack() {
      const [open, setOpen] = React.useState({ outer: true, inner: true });
      return (
        <>
          <Modal
            isOpen={open.outer}
            onClose={() => setOpen((s) => ({ ...s, outer: false }))}
            title="Outer"
          >
            <p>outer</p>
          </Modal>
          <Modal
            isOpen={open.inner}
            onClose={() => setOpen((s) => ({ ...s, inner: false }))}
            title="Inner"
          >
            <p>inner</p>
          </Modal>
        </>
      );
    }

    render(<Stack />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("inner")).toBeNull();
    expect(screen.getByText("outer")).toBeTruthy();

    // The dialog underneath becomes topmost once the one above it is gone.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("outer")).toBeNull();
  });

  it("returns focus to the control that opened it", () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Modal isOpen={open} onClose={() => setOpen(false)} title="Details">
            <p>body</p>
          </Modal>
        </>
      );
    }

    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });
});

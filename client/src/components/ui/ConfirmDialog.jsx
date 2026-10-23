import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { AlertCircle } from "lucide-react";
import Modal from "./Modal";
import Button from "./Button";
import styles from "./ConfirmDialog.module.css";

/**
 * ConfirmDialog Component
 * Reusable confirmation dialog to replace window.confirm
 *
 * If `onConfirm` returns a promise, the dialog waits for it and only closes
 * when it settles successfully. Closing first discarded the dialog along with
 * whatever the user was about to destroy, so a rejected delete looked like it
 * had happened.
 */
const ConfirmDialog = React.memo(function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger", // "danger" | "primary" | "success"
  ...props
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // A reopened dialog must not still be showing the previous attempt's failure.
  useEffect(() => {
    if (isOpen) {
      setBusy(false);
      setError("");
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    setError("");
    setBusy(true);
    let failed = false;
    try {
      const result = onConfirm();
      if (result && typeof result.then === "function") await result;
    } catch (err) {
      failed = true;
      setError(err?.message || "The action could not be completed");
    } finally {
      setBusy(false);
    }
    // Synchronous callers resolve immediately and close exactly as before.
    if (!failed) onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={busy ? () => {} : onClose}
      title={variant !== "success" ? title : undefined}
      size="sm"
      zIndex={4000}
      {...props}
    >
      <div className={styles.content}>
        {variant === "success" && (
          <>
            <div className={styles.iconContainer}>
              <AlertCircle size={48} className={styles.warningIcon} />
            </div>
            <h3 className={styles.title}>{title}</h3>
          </>
        )}
        <p className={styles.message}>{message}</p>
        {error && (
          <p className={styles.errorText} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={busy}
            className={styles.cancelButton}
          >
            {cancelText}
          </Button>
          <Button
            variant="outline"
            onClick={handleConfirm}
            disabled={busy}
            className={variant === "danger" ? styles.dangerConfirmButton : styles.confirmButton}
          >
            {busy ? "Working..." : confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
});

ConfirmDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
  title: PropTypes.string.isRequired,
  message: PropTypes.string.isRequired,
  confirmText: PropTypes.string,
  cancelText: PropTypes.string,
  variant: PropTypes.oneOf(["primary", "danger", "success"]),
};

export default ConfirmDialog;

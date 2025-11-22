import React from "react";
import PropTypes from "prop-types";
import { AlertCircle } from "lucide-react";
import Modal from "./Modal";
import Button from "./Button";
import styles from "./ConfirmDialog.module.css";

/**
 * ConfirmDialog Component
 * Reusable confirmation dialog to replace window.confirm
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
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={variant !== "success" ? title : undefined}
      size="sm"
      zIndex={20000}
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
        <div className={styles.actions}>
          <Button variant="outline" onClick={onClose} className={styles.cancelButton}>
            {cancelText}
          </Button>
          <Button
            variant="outline"
            onClick={handleConfirm}
            className={variant === "danger" ? styles.dangerConfirmButton : styles.confirmButton}
          >
            {confirmText}
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

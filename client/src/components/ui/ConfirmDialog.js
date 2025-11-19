import React from "react";
import PropTypes from "prop-types";
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
  variant = "danger",
  ...props
}) {
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm" zIndex={20000} {...props}>
      <div className={styles.content}>
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
  variant: PropTypes.oneOf(["primary", "danger"]),
};

export default ConfirmDialog;

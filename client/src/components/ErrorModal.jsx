import React from "react";
import PropTypes from "prop-types";
import { AlertCircle } from "lucide-react";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import styles from "./ErrorModal.module.css";

/**
 * ErrorModal Component
 * Displays error messages in a modal dialog with modern styling
 */
function ErrorModal({ isOpen, onClose, title, message, containerName, details }) {
  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title || "Error"}
      size="lg"
      showCloseButton={true}
    >
      <div className={styles.errorContent}>
        <div className={styles.errorIcon}>
          <AlertCircle size={48} />
        </div>

        {containerName && (
          <div className={styles.containerName}>
            <strong>Container:</strong> {containerName}
          </div>
        )}

        <div className={styles.errorMessage}>
          {message.split("\n").map((line, i) => (
            <React.Fragment key={i}>
              {line}
              {i < message.split("\n").length - 1 && <br />}
            </React.Fragment>
          ))}
        </div>

        {details && (
          <details className={styles.errorDetails}>
            <summary className={styles.detailsSummary}>Technical Details</summary>
            <pre className={styles.detailsContent}>{details}</pre>
          </details>
        )}

        <div className={styles.actions}>
          <Button variant="primary" onClick={onClose} className={styles.closeButton}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

ErrorModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string,
  message: PropTypes.string.isRequired,
  containerName: PropTypes.string,
  details: PropTypes.string,
};

export default ErrorModal;

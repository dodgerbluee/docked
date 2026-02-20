import React, { memo } from "react";
import PropTypes from "prop-types";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import rateLimitStyles from "../RateLimitError.module.css";

/**
 * RateLimitError component
 * Displays Docker Hub rate limit errors with appropriate actions
 */
const RateLimitError = ({ error, onDismiss, onRetry, pulling, loading }) => {
  if (!error) return null;

  const isRateLimit = error.includes("rate limit") || error.includes("Rate limit");

  if (!isRateLimit) {
    return (
      <Alert variant="error">
        <div className={rateLimitStyles.rateLimitContent}>
          <h4 className={rateLimitStyles.rateLimitTitle}>Error</h4>
          <p className={rateLimitStyles.rateLimitMessage}>{error}</p>
          <div className={rateLimitStyles.rateLimitActions}>
            <Button onClick={onRetry} disabled={pulling || loading} variant="primary" size="sm">
              {pulling || loading ? "Retrying..." : "Try Again"}
            </Button>
          </div>
        </div>
      </Alert>
    );
  }

  // Rate limit error - show as modal overlay
  return (
    <Modal isOpen={true} onClose={onDismiss} title="⚠️ Docker Hub Rate Limit Exceeded" size="md">
      <div className={rateLimitStyles.rateLimitContent}>
        <p className={rateLimitStyles.rateLimitMessage}>{error}</p>
        <p className={rateLimitStyles.rateLimitHint}>
          To avoid rate limits, configure Docker Hub authentication on your host machine using{" "}
          <code>docker login</code>.
        </p>
        <div className={rateLimitStyles.rateLimitActions}>
          <Button
            onClick={onDismiss}
            variant="outline"
            size="sm"
            className={rateLimitStyles.dismissButton}
          >
            Dismiss
          </Button>
        </div>
      </div>
    </Modal>
  );
};

RateLimitError.propTypes = {
  error: PropTypes.string,
  onDismiss: PropTypes.func.isRequired,
  onRetry: PropTypes.func.isRequired,
  pulling: PropTypes.bool,
  loading: PropTypes.bool,
};

export default memo(RateLimitError);

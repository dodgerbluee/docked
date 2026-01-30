import React from "react";
import PropTypes from "prop-types";
import { CheckCircle2, Loader2, AlertCircle, X } from "lucide-react";
import Button from "../ui/Button";
import styles from "./UpdatingCard.module.css";

/**
 * Card for the "Updating" section: blend of upgrade progress (spinner/step/success/error)
 * and Updates-style container card (border, padding, grid cell).
 */
function UpdatingCard({ item, onDismiss, onNavigateToLogs }) {
  const name = item.container?.name ?? "Container";
  const status = item.status;
  const stepLabel =
    status === "in_progress" && item.steps?.length
      ? item.steps[item.currentStep]?.label
      : null;

  return (
    <div
      className={`${styles.card} ${styles[`card_${status}`]}`}
      data-status={status}
      role="article"
      aria-label={`Upgrade ${name} - ${status}`}
    >
      <div className={styles.cardMain}>
        {status === "in_progress" && (
          <Loader2 size={20} className={styles.spinner} aria-hidden />
        )}
        {status === "success" && (
          <CheckCircle2 size={20} className={styles.successIcon} aria-hidden />
        )}
        {status === "error" && (
          <AlertCircle size={20} className={styles.errorIcon} aria-hidden />
        )}
        <div className={styles.cardContent}>
          <span className={styles.containerName}>{name}</span>
          {status === "in_progress" && stepLabel && (
            <span className={styles.stepLabel}>{stepLabel}</span>
          )}
          {status === "success" && (
            <span className={styles.statusLabel}>Upgraded</span>
          )}
          {status === "error" && (
            <span className={styles.errorMessage} title={item.errorMessage ?? undefined}>
              {item.errorMessage ?? "Upgrade failed"}
            </span>
          )}
        </div>
      </div>
      <div className={styles.cardActions}>
        {status === "error" && onNavigateToLogs && (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onNavigateToLogs();
            }}
            className={styles.viewLogsBtn}
          >
            View Logs
          </Button>
        )}
        {(status === "success" || status === "error") && (
          <button
            type="button"
            className={styles.dismissBtn}
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(item.key);
            }}
            aria-label={`Dismiss ${name}`}
            title="Dismiss"
          >
            <X size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

UpdatingCard.propTypes = {
  item: PropTypes.shape({
    key: PropTypes.string.isRequired,
    container: PropTypes.object,
    status: PropTypes.oneOf(["in_progress", "success", "error"]).isRequired,
    currentStep: PropTypes.number,
    steps: PropTypes.arrayOf(
      PropTypes.shape({ label: PropTypes.string, duration: PropTypes.number })
    ),
    errorMessage: PropTypes.string,
  }).isRequired,
  onDismiss: PropTypes.func.isRequired,
  onNavigateToLogs: PropTypes.func,
};

export default UpdatingCard;

import React from "react";
import PropTypes from "prop-types";
import styles from "./EmptyState.module.css";

/**
 * EmptyState Component
 * Reusable empty state display with customizable message and optional icon
 */
const EmptyState = React.memo(function EmptyState({
  message,
  icon: Icon,
  className = "",
  ...props
}) {
  return (
    <div className={`${styles.emptyState} ${className}`} {...props}>
      {Icon && (
        <div className={styles.iconContainer}>
          <Icon size={48} className={styles.icon} />
        </div>
      )}
      <p className={styles.message}>{message}</p>
    </div>
  );
});

EmptyState.propTypes = {
  message: PropTypes.string.isRequired,
  icon: PropTypes.elementType,
  className: PropTypes.string,
};

export default EmptyState;

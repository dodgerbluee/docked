import React from "react";
import PropTypes from "prop-types";
import styles from "./LoadingSpinner.module.css";

/**
 * LoadingSpinner Component
 * Reusable loading spinner with customizable size and message
 */
const LoadingSpinner = React.memo(function LoadingSpinner({
  size = "md",
  message,
  className = "",
  ...props
}) {
  const sizeClass = styles[size] || styles.md;

  return (
    <div className={`${styles.container} ${className}`} {...props}>
      <svg
        className={`${styles.spinner} ${sizeClass}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Loading"
        role="status"
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      {message && <p className={styles.message}>{message}</p>}
    </div>
  );
});

LoadingSpinner.propTypes = {
  size: PropTypes.oneOf(["sm", "md", "lg"]),
  message: PropTypes.string,
  className: PropTypes.string,
};

export default LoadingSpinner;


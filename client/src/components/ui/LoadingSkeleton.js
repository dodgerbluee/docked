import React from "react";
import PropTypes from "prop-types";
import styles from "./LoadingSkeleton.module.css";

/**
 * LoadingSkeleton Component
 * Provides a loading placeholder with shimmer effect
 */
const LoadingSkeleton = React.memo(function LoadingSkeleton({
  width,
  height,
  borderRadius = "8px",
  className = "",
}) {
  return (
    <div
      className={`${styles.skeleton} ${className}`}
      style={{
        width: width || "100%",
        height: height || "20px",
        borderRadius,
      }}
      aria-label="Loading..."
    />
  );
});

LoadingSkeleton.propTypes = {
  width: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  height: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  borderRadius: PropTypes.string,
  className: PropTypes.string,
};

/**
 * CardSkeleton Component
 * Loading skeleton for card components
 */
export const CardSkeleton = React.memo(function CardSkeleton({ className = "" }) {
  return (
    <div className={`${styles.cardSkeleton} ${className}`}>
      <LoadingSkeleton width="60%" height="24px" />
      <LoadingSkeleton width="100%" height="16px" className={styles.marginTop} />
      <LoadingSkeleton width="80%" height="16px" className={styles.marginTop} />
    </div>
  );
});

CardSkeleton.propTypes = {
  className: PropTypes.string,
};

export default LoadingSkeleton;


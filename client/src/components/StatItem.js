import React from "react";
import PropTypes from "prop-types";
import styles from "./PortainerInstanceCard.module.css";

/**
 * Reusable stat item component for PortainerInstanceCard
 * Reduces code duplication and provides consistent keyboard navigation
 */
const StatItem = ({ value, label, variant = "", onClick }) => {
  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (onClick) {
        onClick();
      }
    }
  };

  const handleClick = (e) => {
    e.stopPropagation();
    if (onClick) {
      onClick();
    }
  };

  // Map variant to CSS module class name
  const variantClass = variant ? styles[variant] : null;
  
  const numberClasses = [
    styles.statNumber,
    variantClass,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={styles.instanceStat}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={`${label}: ${value}`}
    >
      <span className={numberClasses}>{value}</span>
      <span className={styles.statText}>{label}</span>
    </div>
  );
};

StatItem.propTypes = {
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  label: PropTypes.string.isRequired,
  variant: PropTypes.string,
  onClick: PropTypes.func,
};

export default StatItem;


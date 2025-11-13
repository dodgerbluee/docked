import React from "react";
import PropTypes from "prop-types";
import styles from "./StatCard.module.css";

/**
 * Reusable stat card component for displaying statistics
 * @param {Object} props - Component props
 * @param {string|number} props.value - The stat value to display
 * @param {string} props.label - The stat label
 * @param {string} props.variant - Optional variant: 'update-available', 'current', 'unused-images'
 * @param {boolean} props.clickable - Whether the card is clickable
 * @param {Function} props.onClick - Click handler function
 * @param {string} props.className - Additional CSS classes
 */
const StatCard = ({
  value,
  label,
  variant = "",
  clickable = false,
  onClick,
  className = "",
}) => {
  // Map variant names to CSS Module class names (kebab-case to camelCase)
  const variantMap = {
    "update-available": "updateAvailable",
    "unused-images": "unusedImages",
    current: "current",
  };

  const variantClass = variant ? styles[variantMap[variant] || variant] : null;

  const cardClasses = [
    styles.statCard,
    variantClass,
    clickable && styles.clickable,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cardClasses}
      onClick={clickable ? onClick : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable && onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
};

StatCard.propTypes = {
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  label: PropTypes.string.isRequired,
  variant: PropTypes.oneOf([
    "",
    "update-available",
    "current",
    "unused-images",
  ]),
  clickable: PropTypes.bool,
  onClick: PropTypes.func,
  className: PropTypes.string,
};

export default StatCard;


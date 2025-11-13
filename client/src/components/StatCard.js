import React from "react";
import PropTypes from "prop-types";
import { VARIANT_MAP, STAT_CARD_VARIANTS } from "../constants/summaryPage";
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
  variant = STAT_CARD_VARIANTS.DEFAULT,
  clickable = false,
  onClick,
  className = "",
  usePurpleBorder = false,
}) => {
  const variantClass = variant ? styles[VARIANT_MAP[variant] || variant] : null;
  
  // Add purple border class if specified
  const borderClass = usePurpleBorder ? styles.purpleBorder : null;
  
  // Add red border class for UPDATE_AVAILABLE when value > 0
  const redBorderClass = variant === STAT_CARD_VARIANTS.UPDATE_AVAILABLE && typeof value === 'number' && value > 0 ? styles.redBorder : null;

  const cardClasses = [
    styles.statCard,
    variantClass,
    borderClass,
    redBorderClass,
    clickable && styles.clickable,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // Determine value color based on variant and value
  const getValueClassName = () => {
    // "Up to Date" (CURRENT) uses default text color (white in dark mode)
    // "Updates Available" uses default text color (white in dark mode)
    return styles.statValue;
  };

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
      <div className={getValueClassName()}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
};

StatCard.propTypes = {
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  label: PropTypes.string.isRequired,
  variant: PropTypes.oneOf([
    STAT_CARD_VARIANTS.DEFAULT,
    STAT_CARD_VARIANTS.UPDATE_AVAILABLE,
    STAT_CARD_VARIANTS.CURRENT,
    STAT_CARD_VARIANTS.UNUSED_IMAGES,
  ]),
  clickable: PropTypes.bool,
  onClick: PropTypes.func,
  className: PropTypes.string,
  usePurpleBorder: PropTypes.bool,
};

export default StatCard;


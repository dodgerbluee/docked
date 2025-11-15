/**
 * ToggleButtonGroup Component
 * Reusable toggle button group for selecting between options
 */

import React from "react";
import PropTypes from "prop-types";
import styles from "./ToggleButtonGroup.module.css";

/**
 * ToggleButtonGroup component
 * @param {Array} options - Array of option objects with { value, label, icon }
 * @param {string} value - Currently selected value
 * @param {Function} onChange - Handler for value change
 * @param {boolean} disabled - Whether the group is disabled
 * @param {string} className - Additional CSS classes
 */
function ToggleButtonGroup({ options, value, onChange, disabled = false, className = "" }) {
  return (
    <div className={`${styles.toggleGroup} ${className}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`${styles.toggleOption} ${value === option.value ? styles.active : ""}`}
          onClick={() => !disabled && onChange(option.value)}
          disabled={disabled}
          aria-pressed={value === option.value}
        >
          {option.icon && <span className={styles.icon}>{option.icon}</span>}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

ToggleButtonGroup.propTypes = {
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      icon: PropTypes.node,
    })
  ).isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  className: PropTypes.string,
};

export default ToggleButtonGroup;

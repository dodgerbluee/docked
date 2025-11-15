import React from "react";
import PropTypes from "prop-types";
import styles from "./ToggleButton.module.css";

/**
 * ToggleButton Component
 * Reusable toggle button group for options like color scheme
 */
const ToggleButton = React.memo(function ToggleButton({
  options,
  value,
  onChange,
  className = "",
}) {
  return (
    <div className={`${styles.toggleGroup} ${className}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`${styles.toggleOption} ${value === option.value ? styles.active : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.icon && typeof option.icon === "function" && (
            <span className={styles.icon}>{React.createElement(option.icon, { size: 16 })}</span>
          )}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
});

ToggleButton.propTypes = {
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      icon: PropTypes.elementType,
    })
  ).isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  className: PropTypes.string,
};

export default ToggleButton;

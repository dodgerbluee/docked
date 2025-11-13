import React from "react";
import PropTypes from "prop-types";
import { BATCH_INTERVAL_UNITS } from "../../constants/settings";
import styles from "./TimeIntervalInput.module.css";

/**
 * TimeIntervalInput Component
 * Modern time interval input with integrated unit selector
 */
const TimeIntervalInput = React.memo(function TimeIntervalInput({
  id,
  label,
  value,
  unit,
  onChange,
  onUnitChange,
  min = 1,
  required = false,
  disabled = false,
  error,
  helperText,
  className = "",
  ...props
}) {
  const inputId = id || `time-interval-${Math.random().toString(36).substr(2, 9)}`;

  const handleValueChange = (e) => {
    const inputValue = e.target.value;
    // Allow empty string for deletion
    if (inputValue === '') {
      onChange('');
      return;
    }
    // Pass the raw string value to parent, let parent handle validation
    onChange(inputValue);
  };

  const handleUnitToggle = () => {
    const newUnit =
      unit === BATCH_INTERVAL_UNITS.MINUTES
        ? BATCH_INTERVAL_UNITS.HOURS
        : BATCH_INTERVAL_UNITS.MINUTES;
    onUnitChange(newUnit);
  };

  return (
    <div className={`${styles.formGroup} ${className}`}>
      {label && (
        <label htmlFor={inputId} className={styles.label}>
          {label}
          {required && <span className={styles.required}>*</span>}
        </label>
      )}
      <div className={styles.inputContainer}>
        <div className={styles.inputWrapper}>
          <input
            id={inputId}
            type="number"
            value={value === '' || value === null || value === undefined ? '' : value}
            onChange={handleValueChange}
            min={min}
            required={required}
            disabled={disabled}
            className={`${styles.input} ${error ? styles.inputError : ""}`}
            {...props}
          />
        </div>
        <button
          type="button"
          onClick={handleUnitToggle}
          disabled={disabled}
          className={styles.unitButton}
          aria-label={`Switch to ${unit === BATCH_INTERVAL_UNITS.MINUTES ? "hours" : "minutes"}`}
        >
          <span className={styles.unitText}>
            {unit === BATCH_INTERVAL_UNITS.MINUTES ? "min" : "hr"}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={styles.unitIcon}
          >
            <path d="M3 4.5L6 1.5L9 4.5" />
            <path d="M3 7.5L6 10.5L9 7.5" />
          </svg>
        </button>
      </div>
      {error && <div className={styles.errorMessage}>{error}</div>}
      {helperText && !error && <small className={styles.helperText}>{helperText}</small>}
    </div>
  );
});

TimeIntervalInput.propTypes = {
  id: PropTypes.string,
  label: PropTypes.string,
  value: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  unit: PropTypes.oneOf([BATCH_INTERVAL_UNITS.MINUTES, BATCH_INTERVAL_UNITS.HOURS]).isRequired,
  onChange: PropTypes.func.isRequired,
  onUnitChange: PropTypes.func.isRequired,
  min: PropTypes.number,
  required: PropTypes.bool,
  disabled: PropTypes.bool,
  error: PropTypes.string,
  helperText: PropTypes.string,
  className: PropTypes.string,
};

export default TimeIntervalInput;


import React from "react";
import PropTypes from "prop-types";
import styles from "./Input.module.css";

/**
 * Input Component
 * Reusable form input with consistent styling
 */
const Input = React.memo(function Input({
  id,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required = false,
  disabled = false,
  error,
  helperText,
  autoComplete,
  minLength,
  maxLength,
  className = "",
  ...props
}) {
  const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className={`${styles.formGroup} ${className}`}>
      {label && (
        <label htmlFor={inputId} className={styles.label}>
          {label}
          {required && <span className={styles.required}>*</span>}
        </label>
      )}
      <input
        id={inputId}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={maxLength}
        className={`${styles.input} ${error ? styles.inputError : ""}`}
        {...props}
      />
      {error && <div className={styles.errorMessage}>{error}</div>}
      {helperText && !error && <small className={styles.helperText}>{helperText}</small>}
    </div>
  );
});

Input.propTypes = {
  id: PropTypes.string,
  label: PropTypes.string,
  type: PropTypes.string,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
  required: PropTypes.bool,
  disabled: PropTypes.bool,
  error: PropTypes.string,
  helperText: PropTypes.string,
  autoComplete: PropTypes.string,
  minLength: PropTypes.number,
  maxLength: PropTypes.number,
  className: PropTypes.string,
};

export default Input;


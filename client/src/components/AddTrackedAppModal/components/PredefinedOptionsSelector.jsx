/**
 * Reusable component for selecting predefined options (GitHub repos or Docker images)
 */

import React from "react";
import PropTypes from "prop-types";
import Select from "react-select";
import ToggleButton from "../../ui/ToggleButton";
import styles from "../../AddTrackedAppModal.module.css";

/**
 * Predefined options selector component
 * @param {Object} props
 * @param {boolean} props.usePredefined - Whether using predefined option
 * @param {Function} props.onTogglePredefined - Callback when toggle changes
 * @param {Object|null} props.selectedOption - Selected option value
 * @param {Function} props.onSelectOption - Callback when option is selected
 * @param {Array} props.options - Available options
 * @param {string} props.label - Label for the selector
 * @param {string} props.placeholder - Placeholder text
 * @param {string} props.helperText - Helper text
 * @param {Object} props.selectStyles - Custom styles for react-select
 * @param {boolean} props.loading - Whether form is loading
 * @param {string} props.id - Input ID
 */
const PredefinedOptionsSelector = ({
  usePredefined,
  onTogglePredefined,
  selectedOption,
  onSelectOption,
  options,
  label,
  placeholder,
  helperText,
  selectStyles,
  loading,
  id,
}) => {
  return (
    <>
      <div className={styles.formGroup}>
        <label className={styles.label}>{label}</label>
        <ToggleButton
          options={[
            { value: "predefined", label: "Predefined" },
            { value: "manual", label: "Manual Entry" },
          ]}
          value={usePredefined ? "predefined" : "manual"}
          onChange={(value) => {
            if (!loading) {
              onTogglePredefined(value === "predefined");
            }
          }}
          className={styles.selectionToggle}
        />
      </div>

      {usePredefined ? (
        <div className={styles.formGroup}>
          <label htmlFor={id} className={styles.label}>
            {label}
          </label>
          <Select
            id={id}
            value={selectedOption}
            onChange={onSelectOption}
            options={options}
            placeholder={placeholder}
            isSearchable
            isDisabled={loading}
            styles={selectStyles}
            openMenuOnFocus={true}
            classNamePrefix="react-select"
          />
          <small className={styles.helperText}>{helperText}</small>
        </div>
      ) : null}
    </>
  );
};

PredefinedOptionsSelector.propTypes = {
  usePredefined: PropTypes.bool.isRequired,
  onTogglePredefined: PropTypes.func.isRequired,
  selectedOption: PropTypes.object,
  onSelectOption: PropTypes.func.isRequired,
  options: PropTypes.array.isRequired,
  label: PropTypes.string.isRequired,
  placeholder: PropTypes.string.isRequired,
  helperText: PropTypes.string.isRequired,
  selectStyles: PropTypes.object.isRequired,
  loading: PropTypes.bool.isRequired,
  id: PropTypes.string.isRequired,
};

export default PredefinedOptionsSelector;

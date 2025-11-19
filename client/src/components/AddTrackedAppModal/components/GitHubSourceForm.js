/**
 * GitHub source form component
 */

import React from "react";
import PropTypes from "prop-types";
import Input from "../../ui/Input";
import PredefinedOptionsSelector from "./PredefinedOptionsSelector";
import styles from "../../AddTrackedAppModal.module.css";

/**
 * GitHub source form component
 * @param {Object} props
 * @param {boolean} props.usePredefined - Whether using predefined repos
 * @param {Function} props.setUsePredefined - Setter for usePredefined
 * @param {Object|null} props.selectedPredefinedRepo - Selected predefined repo
 * @param {Function} props.setSelectedPredefinedRepo - Setter for selected repo
 * @param {string} props.githubRepo - Manual repo input value
 * @param {Function} props.onChange - Form change handler
 * @param {Array} props.githubRepoOptions - Available predefined repos
 * @param {Object} props.selectStyles - Styles for react-select
 * @param {boolean} props.loading - Whether form is loading
 * @param {Function} props.onClearName - Callback to clear name field
 */
const GitHubSourceForm = ({
  usePredefined,
  setUsePredefined,
  selectedPredefinedRepo,
  setSelectedPredefinedRepo,
  githubRepo,
  onChange,
  githubRepoOptions,
  selectStyles,
  loading,
  onClearName,
}) => {
  return (
    <>
      <PredefinedOptionsSelector
        usePredefined={usePredefined}
        onTogglePredefined={(isPredefined) => {
          if (!loading) {
            setUsePredefined(isPredefined);
            if (isPredefined) {
              onChange({ target: { name: "githubRepo", value: "" } });
              onChange({ target: { name: "name", value: "" } });
            } else {
              setSelectedPredefinedRepo(null);
              onChange({ target: { name: "name", value: "" } });
            }
            if (onClearName) onClearName();
          }
        }}
        selectedOption={selectedPredefinedRepo}
        onSelectOption={setSelectedPredefinedRepo}
        options={githubRepoOptions}
        label="Repository Selection"
        placeholder="Select a repository..."
        helperText="Choose from predefined GitHub repositories"
        selectStyles={selectStyles}
        loading={loading}
        id="predefinedRepo"
      />

      {!usePredefined && (
        <Input
          label="GitHub Repository"
          name="githubRepo"
          type="text"
          value={githubRepo}
          onChange={onChange}
          required={true}
          placeholder="e.g., home-assistant/core or https://github.com/home-assistant/core"
          disabled={loading}
          helperText="GitHub repository in owner/repo format or full GitHub URL"
        />
      )}
    </>
  );
};

GitHubSourceForm.propTypes = {
  usePredefined: PropTypes.bool.isRequired,
  setUsePredefined: PropTypes.func.isRequired,
  selectedPredefinedRepo: PropTypes.object,
  setSelectedPredefinedRepo: PropTypes.func.isRequired,
  githubRepo: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  githubRepoOptions: PropTypes.array.isRequired,
  selectStyles: PropTypes.object.isRequired,
  loading: PropTypes.bool.isRequired,
  onClearName: PropTypes.func,
};

export default GitHubSourceForm;


/**
 * Docker source form component
 */

import React from "react";
import PropTypes from "prop-types";
import Input from "../../ui/Input";
import PredefinedOptionsSelector from "./PredefinedOptionsSelector";
import styles from "../../AddTrackedAppModal.module.css";

/**
 * Docker source form component
 * @param {Object} props
 * @param {boolean} props.usePredefinedDocker - Whether using predefined images
 * @param {Function} props.setUsePredefinedDocker - Setter for usePredefinedDocker
 * @param {Object|null} props.selectedPredefinedImage - Selected predefined image
 * @param {Function} props.setSelectedPredefinedImage - Setter for selected image
 * @param {string} props.imageName - Manual image input value
 * @param {Function} props.onChange - Form change handler
 * @param {Array} props.dockerImageOptions - Available predefined images
 * @param {Object} props.selectStyles - Styles for react-select
 * @param {boolean} props.loading - Whether form is loading
 * @param {Function} props.onClearName - Callback to clear name field
 */
const DockerSourceForm = ({
  usePredefinedDocker,
  setUsePredefinedDocker,
  selectedPredefinedImage,
  setSelectedPredefinedImage,
  imageName,
  onChange,
  dockerImageOptions,
  selectStyles,
  loading,
  onClearName,
}) => {
  return (
    <>
      <PredefinedOptionsSelector
        usePredefined={usePredefinedDocker}
        onTogglePredefined={(isPredefined) => {
          if (!loading) {
            setUsePredefinedDocker(isPredefined);
            if (isPredefined) {
              onChange({ target: { name: "imageName", value: "" } });
              onChange({ target: { name: "name", value: "" } });
            } else {
              setSelectedPredefinedImage(null);
              onChange({ target: { name: "name", value: "" } });
            }
            if (onClearName) onClearName();
          }
        }}
        selectedOption={selectedPredefinedImage}
        onSelectOption={setSelectedPredefinedImage}
        options={dockerImageOptions}
        label="Image Selection"
        placeholder="Select a Docker image..."
        helperText="Choose from predefined Docker images"
        selectStyles={selectStyles}
        loading={loading}
        id="predefinedImage"
      />

      {!usePredefinedDocker && (
        <Input
          label="Image Name"
          name="imageName"
          type="text"
          value={imageName}
          onChange={onChange}
          required={true}
          placeholder="e.g., homeassistant/home-assistant:latest"
          disabled={loading}
          helperText="Docker image name with optional tag (e.g., username/repo:tag)"
        />
      )}
    </>
  );
};

DockerSourceForm.propTypes = {
  usePredefinedDocker: PropTypes.bool.isRequired,
  setUsePredefinedDocker: PropTypes.func.isRequired,
  selectedPredefinedImage: PropTypes.object,
  setSelectedPredefinedImage: PropTypes.func.isRequired,
  imageName: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  dockerImageOptions: PropTypes.array.isRequired,
  selectStyles: PropTypes.object.isRequired,
  loading: PropTypes.bool.isRequired,
  onClearName: PropTypes.func,
};

export default DockerSourceForm;


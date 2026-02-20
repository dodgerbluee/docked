/**
 * Add Tracked Image/Repository Modal
 * Popup form to add a new tracked image or GitHub repository
 */

import React, { useState, useRef } from "react";
import PropTypes from "prop-types";
import axios from "axios";
import { Trash2, Github } from "lucide-react";
import Modal from "./ui/Modal";
import Input from "./ui/Input";
import Button from "./ui/Button";
import Alert from "./ui/Alert";
import { API_BASE_URL } from "../utils/api";
import GitLabIcon from "./icons/GitLabIcon";
import styles from "./AddTrackedImageModal.module.css";
import { useTrackedImageForm } from "./AddTrackedImageModal/hooks/useTrackedImageForm";
import { validateForm } from "./AddTrackedImageModal/utils/trackedImageValidation";
import { selectStyles } from "./AddTrackedImageModal/utils/selectStyles";
import GitHubSourceForm from "./AddTrackedImageModal/components/GitHubSourceForm";
import GitLabSourceForm from "./AddTrackedImageModal/components/GitLabSourceForm";
import DockerSourceForm from "./AddTrackedImageModal/components/DockerSourceForm";

const SOURCE_TYPE_OPTIONS = [
  {
    value: "github",
    label: "GitHub Repository",
    icon: Github,
  },
  {
    value: "gitlab",
    label: "GitLab Repository",
    icon: null, // Will handle GitLab icon separately
  },
  {
    value: "docker",
    label: "Docker Image",
    icon: null, // Will handle Docker icon separately
  },
];

function AddTrackedImageModal({
  isOpen,
  onClose,
  onSuccess,
  trackedImages = [],
  initialData = null,
  onDelete = null,
}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const lastAutoPopulatedNameRef = useRef("");

  // Use extracted form hook
  const formState = useTrackedImageForm({
    trackedImages,
    initialData,
    isOpen,
  });

  const {
    sourceType,
    setSourceType,
    usePredefined,
    setUsePredefined,
    usePredefinedDocker,
    setUsePredefinedDocker,
    selectedPredefinedRepo,
    setSelectedPredefinedRepo,
    selectedPredefinedImage,
    setSelectedPredefinedImage,
    formData,
    handleChange,
    resetForm,
    githubRepoOptions,
    dockerImageOptions,
  } = formState;

  // Clear error when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setError("");
    }
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Validate form
      const validation = validateForm(
        formData,
        sourceType,
        usePredefined,
        usePredefinedDocker,
        selectedPredefinedRepo,
        selectedPredefinedImage
      );

      if (!validation.isValid) {
        setError(Object.values(validation.errors)[0] || "Please fill in all required fields");
        setLoading(false);
        return;
      }

      const payload = {
        name: (formData.name || "").trim(),
        sourceType: sourceType,
      };

      if (sourceType === "github" || sourceType === "gitlab") {
        if (sourceType === "github" && usePredefined && selectedPredefinedRepo) {
          payload.githubRepo = (selectedPredefinedRepo.value || "").trim();
        } else {
          payload.githubRepo = (formData.githubRepo || "").trim();
        }
      } else {
        if (usePredefinedDocker && selectedPredefinedImage) {
          payload.imageName = (selectedPredefinedImage.value || "").trim();
        } else {
          payload.imageName = (formData.imageName || "").trim();
        }
      }

      if (formData.currentVersion && formData.currentVersion.trim()) {
        payload.current_version = formData.currentVersion.trim();
      }

      // Add GitLab token if source type is GitLab (send even if empty to allow clearing)
      if (sourceType === "gitlab") {
        payload.gitlabToken = formData.gitlabToken ? formData.gitlabToken.trim() : "";
      }

      let response;
      if (initialData) {
        response = await axios.put(`${API_BASE_URL}/api/tracked-images/${initialData.id}`, payload);
      } else {
        response = await axios.post(`${API_BASE_URL}/api/tracked-images`, payload);
      }

      if (response.data.success) {
        resetForm();
        // Pass the image ID to onSuccess so it can check the version
        // For create: response.data.id, for update: response.data.image.id
        const imageId = response.data.image?.id || response.data.id || initialData?.id;
        onSuccess(imageId);
        onClose();
      } else {
        setError(
          response.data.error ||
            (initialData ? "Failed to update tracked item" : "Failed to add tracked item")
        );
      }
    } catch (err) {
      setError(
        err.response?.data?.error ||
          (initialData
            ? "Failed to update tracked item. Please try again."
            : "Failed to add tracked item. Please try again.")
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!initialData || !onDelete) return;

    setError("");
    setLoading(true);

    try {
      await onDelete(initialData.id);
      // Only close modal and call onSuccess if deletion was successful (not cancelled)
      onSuccess();
      onClose();
    } catch (err) {
      // Only show error if it's not a cancellation
      if (err.message !== "Deletion cancelled") {
        setError(
          err.response?.data?.error ||
            err.message ||
            "Failed to delete tracked item. Please try again."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  // Handler to clear auto-populated name
  const handleClearName = () => {
    lastAutoPopulatedNameRef.current = "";
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? "Edit Tracked App" : "Add Tracked App"}
      size="lg"
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.formGroup}>
          <label className={styles.label}>Source Type</label>
          <div className={styles.sourceTypeToggle}>
            {SOURCE_TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${styles.sourceTypeButton} ${
                  sourceType === option.value ? styles.active : ""
                }`}
                onClick={() => {
                  if (!loading) {
                    setSourceType(option.value);
                    if (option.value === "github" || option.value === "gitlab") {
                      setUsePredefined(true);
                      setSelectedPredefinedImage(null);
                    } else {
                      setUsePredefinedDocker(true);
                      setSelectedPredefinedRepo(null);
                    }
                  }
                }}
                disabled={loading}
              >
                {option.value === "github" && option.icon && (
                  <span className={styles.icon}>
                    <Github size={16} />
                  </span>
                )}
                {option.value === "gitlab" && (
                  <span className={styles.icon}>
                    <GitLabIcon size={16} />
                  </span>
                )}
                {option.value === "docker" && (
                  <span className={styles.icon}>
                    <img
                      src="/img/docker-mark-white.svg"
                      alt="Docker"
                      className={styles.dockerIcon}
                    />
                  </span>
                )}
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        {sourceType === "docker" ? (
          <DockerSourceForm
            usePredefinedDocker={usePredefinedDocker}
            setUsePredefinedDocker={setUsePredefinedDocker}
            selectedPredefinedImage={selectedPredefinedImage}
            setSelectedPredefinedImage={setSelectedPredefinedImage}
            imageName={formData.imageName}
            onChange={handleChange}
            dockerImageOptions={dockerImageOptions}
            selectStyles={selectStyles}
            loading={loading}
            onClearName={handleClearName}
          />
        ) : sourceType === "github" ? (
          <GitHubSourceForm
            usePredefined={usePredefined}
            setUsePredefined={setUsePredefined}
            selectedPredefinedRepo={selectedPredefinedRepo}
            setSelectedPredefinedRepo={setSelectedPredefinedRepo}
            githubRepo={formData.githubRepo}
            onChange={handleChange}
            githubRepoOptions={githubRepoOptions}
            selectStyles={selectStyles}
            loading={loading}
            onClearName={handleClearName}
          />
        ) : (
          <GitLabSourceForm
            githubRepo={formData.githubRepo}
            gitlabToken={formData.gitlabToken}
            onChange={handleChange}
            loading={loading}
          />
        )}

        <Input
          label="Display Name"
          name="name"
          type="text"
          value={formData.name}
          onChange={handleChange}
          required={true}
          placeholder="e.g., Home Assistant"
          disabled={loading}
          helperText="A friendly name for this tracked item"
        />

        <Input
          label="Current Version (Optional)"
          name="currentVersion"
          type="text"
          value={formData.currentVersion}
          onChange={handleChange}
          placeholder="e.g., 1.42.2.10156"
          disabled={loading}
          helperText="Current installed version (leave empty to auto-detect on first check)"
        />

        {error && <Alert variant="error">{error}</Alert>}

        <div className={styles.actions}>
          {initialData && onDelete && (
            <Button
              type="button"
              variant="outline"
              onClick={handleDelete}
              disabled={loading}
              icon={Trash2}
              className={styles.deleteButton}
            >
              {loading ? "Deleting..." : "Delete"}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="outline"
            disabled={
              loading ||
              !formData.name ||
              (sourceType === "docker" &&
                ((usePredefinedDocker && !selectedPredefinedImage) ||
                  (!usePredefinedDocker && !formData.imageName))) ||
              (sourceType === "github" &&
                ((usePredefined && !selectedPredefinedRepo) ||
                  (!usePredefined && !formData.githubRepo))) ||
              (sourceType === "gitlab" && !formData.githubRepo)
            }
            className={styles.submitButton}
          >
            {loading
              ? initialData
                ? "Updating..."
                : "Adding..."
              : initialData
                ? "Update Tracked App"
                : "Add Tracked App"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

AddTrackedImageModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func.isRequired,
  trackedImages: PropTypes.array,
  initialData: PropTypes.object,
  onDelete: PropTypes.func,
};

export default AddTrackedImageModal;

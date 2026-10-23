/**
 * Add Tracked App Modal
 * Popup form to add a new tracked app (GitHub/GitLab repository or Docker image)
 */

import React, { useState, useRef } from "react";
import PropTypes from "prop-types";
import { Trash2, Github } from "lucide-react";
import Modal from "./ui/Modal";
import Input from "./ui/Input";
import Button from "./ui/Button";
import Alert from "./ui/Alert";
import { graphqlClient } from "../graphql/client";
import { getSessionGeneration, isSessionStale } from "../utils/cacheRegistry";
import { CREATE_TRACKED_APP_MUTATION, UPDATE_TRACKED_APP_MUTATION } from "../graphql/queries";
import GitLabIcon from "./icons/GitLabIcon";
import styles from "./AddTrackedAppModal.module.css";
import { useTrackedAppForm } from "./AddTrackedAppModal/hooks/useTrackedAppForm";
import { validateForm } from "./AddTrackedAppModal/utils/trackedAppValidation";
import { selectStyles } from "./AddTrackedAppModal/utils/selectStyles";
import GitHubSourceForm from "./AddTrackedAppModal/components/GitHubSourceForm";
import GitLabSourceForm from "./AddTrackedAppModal/components/GitLabSourceForm";
import DockerSourceForm from "./AddTrackedAppModal/components/DockerSourceForm";

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

function AddTrackedAppModal({
  isOpen,
  onClose,
  onSuccess,
  trackedApps = [],
  initialData = null,
  onDelete = null,
}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const lastAutoPopulatedNameRef = useRef("");

  // Use extracted form hook
  const formState = useTrackedAppForm({
    trackedApps,
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
    setFormData,
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

  // Reset form when modal closes (after it's fully closed, so user doesn't see the reset)
  React.useEffect(() => {
    if (!isOpen) {
      // Use a small delay to ensure modal is fully closed before resetting
      // This prevents the form from resetting while still visible
      const timeoutId = setTimeout(() => {
        resetForm();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen, resetForm]);

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

      const input = {
        name: (formData.name || "").trim(),
        sourceType: sourceType,
      };

      if (sourceType === "github" || sourceType === "gitlab") {
        if (sourceType === "github" && usePredefined && selectedPredefinedRepo) {
          input.githubRepo = (selectedPredefinedRepo.value || "").trim();
        } else {
          input.githubRepo = (formData.githubRepo || "").trim();
        }
      } else {
        if (usePredefinedDocker && selectedPredefinedImage) {
          input.imageName = (selectedPredefinedImage.value || "").trim();
        } else {
          input.imageName = (formData.imageName || "").trim();
        }
      }

      if (formData.currentVersion && formData.currentVersion.trim()) {
        input.currentVersion = formData.currentVersion.trim();
      }

      // GitLab token kept for backward compatibility when no token row is used
      if (sourceType === "gitlab") {
        input.gitlabToken = formData.gitlabToken ? formData.gitlabToken.trim() : "";
      }

      let result;
      const generation = getSessionGeneration();
      if (initialData) {
        result = await graphqlClient
          .mutation(UPDATE_TRACKED_APP_MUTATION, { id: initialData.id, input })
          .toPromise();
      } else {
        result = await graphqlClient.mutation(CREATE_TRACKED_APP_MUTATION, { input }).toPromise();
      }

      const savedApp = result.data?.updateTrackedApp || result.data?.createTrackedApp;
      if (!result.error && savedApp) {
        // The save can complete after logout. onSuccess() chains straight into
        // the post-create version check, so it must not run once this session
        // is dead — its follow-up mutations would land in the replacement one.
        if (isSessionStale(generation)) {
          setLoading(false);
          return;
        }

        // Pass the app ID to onSuccess so it can check the version
        const imageId = savedApp.id || initialData?.id;

        // Wait for onSuccess to complete (including recheck) before closing modal
        // This ensures the UI shows the correct state immediately and prevents
        // showing intermediate states (red sidebar, etc.)
        // Keep loading state active during recheck
        try {
          if (onSuccess) {
            await onSuccess(imageId);
          }
          // Close modal and clear loading state after recheck completes
          // Form will be reset when modal closes (via useEffect)
          onClose();
        } catch (err) {
          // If recheck fails, still close the modal but log the error
          console.error("Error during post-edit recheck:", err);
          // Form will be reset when modal closes (via useEffect)
          onClose();
        } finally {
          setLoading(false);
        }
      } else {
        setError(
          result.error?.message ||
            (initialData ? "Failed to update tracked item" : "Failed to add tracked item")
        );
        setLoading(false);
      }
    } catch (err) {
      setError(
        err.message ||
          (initialData
            ? "Failed to update tracked item. Please try again."
            : "Failed to add tracked item. Please try again.")
      );
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
            repositoryTokenId={formData.repositoryTokenId}
            onChange={handleChange}
            onTokenChange={(tokenId) => {
              setFormData({ ...formData, repositoryTokenId: tokenId });
            }}
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

AddTrackedAppModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func.isRequired,
  trackedApps: PropTypes.array,
  initialData: PropTypes.object,
  onDelete: PropTypes.func,
};

export default AddTrackedAppModal;

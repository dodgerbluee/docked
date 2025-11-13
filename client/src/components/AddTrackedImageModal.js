/**
 * Add Tracked Image/Repository Modal
 * Popup form to add a new tracked image or GitHub repository
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import PropTypes from "prop-types";
import axios from "axios";
import Select from "react-select";
import { Trash2, Github } from "lucide-react";
import Modal from "./ui/Modal";
import Input from "./ui/Input";
import Button from "./ui/Button";
import ToggleButton from "./ui/ToggleButton";
import Alert from "./ui/Alert";
import { API_BASE_URL } from "../utils/api";
import {
  PREDEFINED_GITHUB_REPOS,
  PREDEFINED_DOCKER_IMAGES,
} from "../constants/trackedApps";
import {
  getTrackedGitHubRepos,
  getTrackedDockerImages,
  filterTrackedItems,
} from "../utils/trackedAppsFilters";
import styles from "./AddTrackedImageModal.module.css";

const SOURCE_TYPE_OPTIONS = [
  {
    value: "github",
    label: "GitHub Repository",
    icon: Github,
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
  const [sourceType, setSourceType] = useState("github");
  const [usePredefined, setUsePredefined] = useState(true);
  const [usePredefinedDocker, setUsePredefinedDocker] = useState(true);
  const [selectedPredefinedRepo, setSelectedPredefinedRepo] = useState(null);
  const [selectedPredefinedImage, setSelectedPredefinedImage] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    imageName: "",
    githubRepo: "",
    currentVersion: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const lastAutoPopulatedName = useRef("");

  // Get available options for react-select (filter out already tracked)
  const githubRepoOptions = useMemo(() => {
    const tracked = getTrackedGitHubRepos(trackedImages);
    return filterTrackedItems(PREDEFINED_GITHUB_REPOS, tracked).map((repo) => ({
      value: repo,
      label: repo,
    }));
  }, [trackedImages]);

  const dockerImageOptions = useMemo(() => {
    const tracked = getTrackedDockerImages(trackedImages);
    return filterTrackedItems(PREDEFINED_DOCKER_IMAGES, tracked).map((image) => ({
      value: image,
      label: image,
    }));
  }, [trackedImages]);

  // Custom styles for react-select to match existing design
  const selectStyles = {
    control: (base, state) => ({
      ...base,
      border: `2px solid ${
        state.isFocused ? "var(--dodger-blue)" : "var(--border-color)"
      }`,
      borderRadius: "8px",
      backgroundColor: "var(--bg-primary)",
      color: "var(--text-primary)",
      boxShadow: "none",
      "&:hover": {
        borderColor: "var(--dodger-blue)",
      },
      outline: "none",
      "&:focus-within": {
        boxShadow: "none",
      },
    }),
    menu: (base) => ({
      ...base,
      backgroundColor: "var(--bg-primary)",
      border: "2px solid var(--border-color)",
      borderRadius: "8px",
      zIndex: 9999,
    }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isFocused
        ? "var(--bg-secondary)"
        : state.isSelected
        ? "var(--dodger-blue)"
        : "var(--bg-primary)",
      color: state.isSelected ? "white" : "var(--text-primary)",
      "&:active": {
        backgroundColor: "var(--dodger-blue)",
      },
    }),
    input: (base, state) => ({
      ...base,
      color: "var(--text-primary)",
      margin: 0,
      padding: 0,
      "&:focus": {
        outline: "none",
        boxShadow: "none",
        border: "none",
      },
      "& input": {
        outline: "none !important",
        boxShadow: "none !important",
        border: "none !important",
      },
    }),
    valueContainer: (base, state) => ({
      ...base,
      padding: "2px 8px",
    }),
    singleValue: (base) => ({
      ...base,
      color: "var(--text-primary)",
    }),
    placeholder: (base, state) => ({
      ...base,
      color: "var(--text-tertiary)",
      opacity: state.isFocused ? 0 : 1,
      transition: "opacity 0.2s",
    }),
  };

  // Auto-populate display name from selected repository/image
  useEffect(() => {
    const currentName = (formData.name || "").trim();
    const shouldUpdate =
      currentName === "" || currentName === lastAutoPopulatedName.current;

    if (shouldUpdate) {
      let nameToSet = "";

      if (sourceType === "github" && usePredefined && selectedPredefinedRepo) {
        const repo = selectedPredefinedRepo.value || selectedPredefinedRepo;
        const parts = repo.split("/");
        nameToSet = parts.length > 1 ? parts[parts.length - 1] : repo;
      } else if (
        sourceType === "github" &&
        !usePredefined &&
        formData.githubRepo
      ) {
        const repo = (formData.githubRepo || "").trim();
        const match = repo.match(
          /(?:github\.com\/)?([^\/]+\/([^\/]+))(?:\/|$)/
        );
        if (match) {
          nameToSet = match[2] || match[1].split("/")[1];
        } else {
          const parts = repo.split("/");
          nameToSet = parts.length > 1 ? parts[parts.length - 1] : repo;
        }
      } else if (
        sourceType === "docker" &&
        usePredefinedDocker &&
        selectedPredefinedImage
      ) {
        const image = selectedPredefinedImage.value || selectedPredefinedImage;
        const parts = image.split("/");
        nameToSet = parts.length > 1 ? parts[parts.length - 1] : image;
      } else if (
        sourceType === "docker" &&
        !usePredefinedDocker &&
        formData.imageName
      ) {
        const image = (formData.imageName || "").trim();
        const imageWithoutTag = image.split(":")[0];
        const parts = imageWithoutTag.split("/");
        nameToSet =
          parts.length > 1 ? parts[parts.length - 1] : imageWithoutTag;
      }

      if (nameToSet) {
        const capitalizedName =
          nameToSet.charAt(0).toUpperCase() + nameToSet.slice(1);
        lastAutoPopulatedName.current = capitalizedName;
        setFormData((prev) => ({ ...prev, name: capitalizedName }));
      }
    }
  }, [
    selectedPredefinedRepo,
    selectedPredefinedImage,
    formData.githubRepo,
    formData.imageName,
    formData.name,
    sourceType,
    usePredefined,
    usePredefinedDocker,
  ]);

  // Clear error and reset form when modal opens or closes, or populate with initialData for editing
  useEffect(() => {
    if (isOpen) {
      setError("");
      if (initialData) {
        setFormData({
          name: initialData.name || "",
          imageName: initialData.image_name || "",
          githubRepo: initialData.github_repo || "",
          currentVersion: initialData.current_version || "",
        });
        setSourceType(initialData.source_type || "github");
        const isPredefinedRepo = PREDEFINED_GITHUB_REPOS.includes(
          initialData.github_repo
        );
        const isPredefinedImage = PREDEFINED_DOCKER_IMAGES.some(
          (img) =>
            initialData.image_name && initialData.image_name.split(":")[0] === img
        );
        setUsePredefined(isPredefinedRepo);
        setUsePredefinedDocker(isPredefinedImage);
        if (isPredefinedRepo) {
          setSelectedPredefinedRepo({
            value: initialData.github_repo,
            label: initialData.github_repo,
          });
        }
        if (isPredefinedImage && initialData.image_name) {
          const imageWithoutTag = initialData.image_name.split(":")[0];
          setSelectedPredefinedImage({
            value: imageWithoutTag,
            label: imageWithoutTag,
          });
        }
        lastAutoPopulatedName.current = initialData.name || "";
      } else {
        setFormData({
          name: "",
          imageName: "",
          githubRepo: "",
          currentVersion: "",
        });
        setSourceType("github");
        setUsePredefined(true);
        setUsePredefinedDocker(true);
        setSelectedPredefinedRepo(null);
        setSelectedPredefinedImage(null);
        lastAutoPopulatedName.current = "";
      }
    }
  }, [isOpen, initialData]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const payload = {
        name: (formData.name || "").trim(),
        sourceType: sourceType,
      };

      if (sourceType === "github") {
        if (usePredefined && selectedPredefinedRepo) {
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

      let response;
      if (initialData) {
        response = await axios.put(
          `${API_BASE_URL}/api/tracked-images/${initialData.id}`,
          payload
        );
      } else {
        response = await axios.post(
          `${API_BASE_URL}/api/tracked-images`,
          payload
        );
      }

      if (response.data.success) {
        setFormData({
          name: "",
          imageName: "",
          githubRepo: "",
          currentVersion: "",
        });
        setSourceType("github");
        // Pass the image ID to onSuccess so it can check the version
        // For create: response.data.id, for update: response.data.image.id
        const imageId = response.data.image?.id || response.data.id || initialData?.id;
        onSuccess(imageId);
        onClose();
      } else {
        setError(
          response.data.error ||
            (initialData
              ? "Failed to update tracked item"
              : "Failed to add tracked item")
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
      onSuccess();
      onClose();
    } catch (err) {
      setError(
        err.response?.data?.error ||
          "Failed to delete tracked item. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  // Custom source type options with Docker icon handling
  const sourceTypeOptions = SOURCE_TYPE_OPTIONS.map((option) => {
    if (option.value === "docker") {
      return {
        ...option,
        icon: null, // Will render custom icon in JSX
      };
    }
    return option;
  });

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
                    if (option.value === "github") {
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
          <>
            <div className={styles.formGroup}>
              <label className={styles.label}>Image Selection</label>
              <ToggleButton
                options={[
                  { value: "predefined", label: "Predefined" },
                  { value: "manual", label: "Manual Entry" },
                ]}
                value={usePredefinedDocker ? "predefined" : "manual"}
                onChange={(value) => {
                  if (!loading) {
                    const isPredefined = value === "predefined";
                    setUsePredefinedDocker(isPredefined);
                    if (isPredefined) {
                      setFormData({ ...formData, imageName: "", name: "" });
                    } else {
                      setSelectedPredefinedImage(null);
                      setFormData({ ...formData, name: "" });
                    }
                    lastAutoPopulatedName.current = "";
                  }
                }}
                className={styles.selectionToggle}
              />
            </div>

            {usePredefinedDocker ? (
              <div className={styles.formGroup}>
                <label htmlFor="predefinedImage" className={styles.label}>
                  Select Docker Image
                </label>
                <Select
                  id="predefinedImage"
                  value={selectedPredefinedImage}
                  onChange={setSelectedPredefinedImage}
                  options={dockerImageOptions}
                  placeholder="Select a Docker image..."
                  isSearchable
                  isDisabled={loading}
                  styles={selectStyles}
                  openMenuOnFocus={true}
                  classNamePrefix="react-select"
                />
                <small className={styles.helperText}>
                  Choose from predefined Docker images
                </small>
              </div>
            ) : (
              <Input
                label="Image Name"
                name="imageName"
                type="text"
                value={formData.imageName}
                onChange={handleChange}
                required={true}
                placeholder="e.g., homeassistant/home-assistant:latest"
                disabled={loading}
                helperText="Docker image name with optional tag (e.g., username/repo:tag)"
              />
            )}
          </>
        ) : (
          <>
            <div className={styles.formGroup}>
              <label className={styles.label}>Repository Selection</label>
              <ToggleButton
                options={[
                  { value: "predefined", label: "Predefined" },
                  { value: "manual", label: "Manual Entry" },
                ]}
                value={usePredefined ? "predefined" : "manual"}
                onChange={(value) => {
                  if (!loading) {
                    const isPredefined = value === "predefined";
                    setUsePredefined(isPredefined);
                    if (isPredefined) {
                      setFormData({ ...formData, githubRepo: "", name: "" });
                    } else {
                      setSelectedPredefinedRepo(null);
                      setFormData({ ...formData, name: "" });
                    }
                    lastAutoPopulatedName.current = "";
                  }
                }}
                className={styles.selectionToggle}
              />
            </div>

            {usePredefined ? (
              <div className={styles.formGroup}>
                <label htmlFor="predefinedRepo" className={styles.label}>
                  Select Repository
                </label>
                <Select
                  id="predefinedRepo"
                  value={selectedPredefinedRepo}
                  onChange={setSelectedPredefinedRepo}
                  options={githubRepoOptions}
                  placeholder="Select a repository..."
                  isSearchable
                  isDisabled={loading}
                  styles={selectStyles}
                  openMenuOnFocus={true}
                  classNamePrefix="react-select"
                />
                <small className={styles.helperText}>
                  Choose from predefined GitHub repositories
                </small>
              </div>
            ) : (
              <Input
                label="GitHub Repository"
                name="githubRepo"
                type="text"
                value={formData.githubRepo}
                onChange={handleChange}
                required={true}
                placeholder="e.g., home-assistant/core or https://github.com/home-assistant/core"
                disabled={loading}
                helperText="GitHub repository in owner/repo format or full GitHub URL"
              />
            )}
          </>
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
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={loading}
          >
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
                  (!usePredefined && !formData.githubRepo)))
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

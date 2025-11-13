/**
 * Add Tracked Image/Repository Modal
 * Popup form to add a new tracked image or GitHub repository
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import axios from "axios";
import Select from "react-select";
import { Trash2 } from "lucide-react";
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
import ToggleButtonGroup from "./ToggleButtonGroup";
import GitHubIcon from "./icons/GitHubIcon";
import "./AddPortainerModal.css";

function AddTrackedImageModal({
  isOpen,
  onClose,
  onSuccess,
  trackedImages = [],
  initialData = null,
  onDelete = null,
}) {
  const [sourceType, setSourceType] = useState("github"); // 'docker' or 'github'
  const [usePredefined, setUsePredefined] = useState(true); // For GitHub repos - default to predefined
  const [usePredefinedDocker, setUsePredefinedDocker] = useState(true); // For Docker images - default to predefined
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
  const mouseDownInsideModal = useRef(false);

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
    // Only auto-populate if display name is empty OR matches the last auto-populated name
    // This allows updating when selection changes, but preserves manual edits
    const currentName = (formData.name || "").trim();
    const shouldUpdate =
      currentName === "" || currentName === lastAutoPopulatedName.current;

    if (shouldUpdate) {
      let nameToSet = "";

      if (sourceType === "github" && usePredefined && selectedPredefinedRepo) {
        // Extract text after last slash from GitHub repo
        const repo = selectedPredefinedRepo.value || selectedPredefinedRepo;
        const parts = repo.split("/");
        nameToSet = parts.length > 1 ? parts[parts.length - 1] : repo;
      } else if (
        sourceType === "github" &&
        !usePredefined &&
        formData.githubRepo
      ) {
        // Extract from manual GitHub repo entry
        const repo = (formData.githubRepo || "").trim();
        // Handle both "owner/repo" and "https://github.com/owner/repo" formats
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
        // Extract text after last slash from Docker image
        const image = selectedPredefinedImage.value || selectedPredefinedImage;
        const parts = image.split("/");
        nameToSet = parts.length > 1 ? parts[parts.length - 1] : image;
      } else if (
        sourceType === "docker" &&
        !usePredefinedDocker &&
        formData.imageName
      ) {
        // Extract from manual Docker image entry
        const image = (formData.imageName || "").trim();
        // Remove tag if present (e.g., "image:tag" -> "image")
        const imageWithoutTag = image.split(":")[0];
        const parts = imageWithoutTag.split("/");
        nameToSet =
          parts.length > 1 ? parts[parts.length - 1] : imageWithoutTag;
      }

      if (nameToSet) {
        // Capitalize first letter
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
        // Edit mode - populate form with existing data
        setFormData({
          name: initialData.name || "",
          imageName: initialData.image_name || "",
          githubRepo: initialData.github_repo || "",
          currentVersion: initialData.current_version || "",
        });
        setSourceType(initialData.source_type || "github");
        // For predefined options, we'll need to check if the repo/image matches predefined lists
        const isPredefinedRepo = PREDEFINED_GITHUB_REPOS.includes(initialData.github_repo);
        const isPredefinedImage = PREDEFINED_DOCKER_IMAGES.some(img => 
          initialData.image_name && initialData.image_name.split(":")[0] === img
        );
        setUsePredefined(isPredefinedRepo);
        setUsePredefinedDocker(isPredefinedImage);
        if (isPredefinedRepo) {
          setSelectedPredefinedRepo({ value: initialData.github_repo, label: initialData.github_repo });
        }
        if (isPredefinedImage && initialData.image_name) {
          const imageWithoutTag = initialData.image_name.split(":")[0];
          setSelectedPredefinedImage({ value: imageWithoutTag, label: imageWithoutTag });
        }
        lastAutoPopulatedName.current = initialData.name || "";
      } else {
        // Add mode - reset form
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

      // Add current version if provided
      if (formData.currentVersion && formData.currentVersion.trim()) {
        payload.current_version = formData.currentVersion.trim();
      }

      let response;
      if (initialData) {
        // Edit mode - use PUT
        response = await axios.put(
          `${API_BASE_URL}/api/tracked-images/${initialData.id}`,
          payload
        );
      } else {
        // Add mode - use POST
        response = await axios.post(
          `${API_BASE_URL}/api/tracked-images`,
          payload
        );
      }

      if (response.data.success) {
        // Reset form
        setFormData({
          name: "",
          imageName: "",
          githubRepo: "",
          currentVersion: "",
        });
        setSourceType("github");
        onSuccess();
        onClose();
      } else {
        setError(response.data.error || (initialData ? "Failed to update tracked item" : "Failed to add tracked item"));
      }
    } catch (err) {
      setError(
        err.response?.data?.error ||
          (initialData ? "Failed to update tracked item. Please try again." : "Failed to add tracked item. Please try again.")
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

  if (!isOpen) return null;

  // Handle overlay mousedown - track if it started on overlay
  const handleOverlayMouseDown = (e) => {
    // Only set flag if mousedown is directly on overlay (not a child)
    if (e.target === e.currentTarget) {
      mouseDownInsideModal.current = false;
    }
  };

  // Handle overlay click - only close if both mousedown and mouseup happened on overlay
  const handleOverlayClick = (e) => {
    // Only close if:
    // 1. The click target is the overlay itself (not a child element)
    // 2. The mousedown didn't start inside the modal content
    if (e.target === e.currentTarget && !mouseDownInsideModal.current) {
      onClose();
    }
  };

  // Track mousedown events to detect if user started interaction inside modal
  const handleModalContentMouseDown = () => {
    mouseDownInsideModal.current = true;
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
    >
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handleModalContentMouseDown}
      >
        <div className="modal-header">
          <h2>{initialData ? "Edit Tracked App" : "Add Tracked App"}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label>Source Type *</label>
            <ToggleButtonGroup
              options={[
                {
                  value: "github",
                  label: "GitHub Repository",
                  icon: <GitHubIcon size={18} />,
                },
                {
                  value: "docker",
                  label: "Docker Image",
                  icon: (
                    <img
                      src="/img/docker-mark-white.svg"
                      alt="Docker"
                      style={{
                        width: "18px",
                        height: "18px",
                        display: "inline-block",
                        verticalAlign: "middle",
                      }}
                    />
                  ),
                },
              ]}
              value={sourceType}
              onChange={(value) => {
                if (!loading) {
                  setSourceType(value);
                  if (value === "github") {
                    setUsePredefined(true);
                    setSelectedPredefinedImage(null);
                  } else {
                    setUsePredefinedDocker(true);
                    setSelectedPredefinedRepo(null);
                  }
                }
              }}
              disabled={loading}
            />
          </div>

          {sourceType === "docker" ? (
            <>
              <div className="form-group">
                <label>Image Selection *</label>
                <ToggleButtonGroup
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
                        setFormData({ ...formData, imageName: "" });
                      } else {
                        setSelectedPredefinedImage(null);
                      }
                    }
                  }}
                  disabled={loading}
                />
              </div>

              {usePredefinedDocker ? (
                <div className="form-group">
                  <label htmlFor="predefinedImage">Select Docker Image *</label>
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
                    required
                  />
                  <small>Choose from predefined Docker images</small>
                </div>
              ) : (
                <div className="form-group">
                  <label htmlFor="imageName">Image Name *</label>
                  <input
                    type="text"
                    id="imageName"
                    name="imageName"
                    value={formData.imageName}
                    onChange={handleChange}
                    required
                    placeholder="e.g., homeassistant/home-assistant:latest"
                    disabled={loading}
                  />
                  <small>
                    Docker image name with optional tag (e.g.,
                    username/repo:tag)
                  </small>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="form-group">
                <label>Repository Selection *</label>
                <ToggleButtonGroup
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
                        setFormData({ ...formData, githubRepo: "" });
                      } else {
                        setSelectedPredefinedRepo(null);
                      }
                    }
                  }}
                  disabled={loading}
                />
              </div>

              {usePredefined ? (
                <div className="form-group">
                  <label htmlFor="predefinedRepo">Select Repository *</label>
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
                    required
                  />
                  <small>Choose from predefined GitHub repositories</small>
                </div>
              ) : (
                <div className="form-group">
                  <label htmlFor="githubRepo">GitHub Repository *</label>
                  <input
                    type="text"
                    id="githubRepo"
                    name="githubRepo"
                    value={formData.githubRepo}
                    onChange={handleChange}
                    required
                    placeholder="e.g., home-assistant/core or https://github.com/home-assistant/core"
                    disabled={loading}
                  />
                  <small>
                    GitHub repository in owner/repo format or full GitHub URL
                  </small>
                </div>
              )}
            </>
          )}

          <div className="form-group">
            <label htmlFor="name">Display Name *</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              placeholder="e.g., Home Assistant"
              disabled={loading}
            />
            <small>A friendly name for this tracked item</small>
          </div>

          <div className="form-group">
            <label htmlFor="currentVersion">Current Version (Optional)</label>
            <input
              type="text"
              id="currentVersion"
              name="currentVersion"
              value={formData.currentVersion}
              onChange={handleChange}
              placeholder="e.g., 1.42.2.10156"
              disabled={loading}
            />
            <small>
              Current installed version (leave empty to auto-detect on first
              check)
            </small>
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="modal-actions">
            {initialData && onDelete && (
              <button
                type="button"
                className="update-button danger-button"
                onClick={handleDelete}
                disabled={loading}
                title={loading ? "Deleting..." : "Delete"}
                style={{
                  marginRight: "auto",
                  marginTop: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "8px 16px",
                }}
              >
                {loading ? "Deleting..." : <Trash2 size={16} />}
              </button>
            )}
            <button
              type="button"
              className="modal-button cancel"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="modal-button submit"
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
            >
              {loading ? (initialData ? "Updating..." : "Adding...") : (initialData ? "Update Tracked App" : "Add Tracked App")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddTrackedImageModal;

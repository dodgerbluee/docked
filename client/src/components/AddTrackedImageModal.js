/**
 * Add Tracked Image/Repository Modal
 * Popup form to add a new tracked image or GitHub repository
 */

import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import Select from "react-select";
import "./AddPortainerModal.css";

// In production, API is served from same origin, so use relative URLs
const API_BASE_URL =
  process.env.REACT_APP_API_URL ||
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");

// Predefined GitHub repositories (in alphabetical order)
const PREDEFINED_GITHUB_REPOS = [
  "AdguardTeam/AdGuardHome",
  "goauthentik/authentik",
  "home-assistant/core",
  "jellyfin/jellyfin",
  "linuxserver/docker-plex",
  "open-webui/open-webui",
];

// Predefined Docker images (in alphabetical order)
const PREDEFINED_DOCKER_IMAGES = [
  "henrygd/beszel",
  "homebridge/homebridge",
  "ollama/ollama",
  "open-webui/open-webui",
  "pterodactyl/panel",
  "pterodactyl/wings",
];

function AddTrackedImageModal({ isOpen, onClose, onSuccess, trackedImages = [] }) {
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

  // Get already tracked items to filter them out
  const getTrackedGitHubRepos = () => {
    return trackedImages
      .filter((img) => img.source_type === "github" && img.github_repo)
      .map((img) => img.github_repo);
  };

  const getTrackedDockerImages = () => {
    return trackedImages
      .filter((img) => img.source_type === "docker" && img.image_name)
      .map((img) => img.image_name.split(":")[0]); // Remove tag for comparison
  };

  // Get available options for react-select (filter out already tracked)
  const githubRepoOptions = useMemo(() => {
    const tracked = trackedImages
      .filter((img) => img.source_type === "github" && img.github_repo)
      .map((img) => img.github_repo);
    return PREDEFINED_GITHUB_REPOS.filter((repo) => !tracked.includes(repo))
      .map((repo) => ({ value: repo, label: repo }));
  }, [trackedImages]);

  const dockerImageOptions = useMemo(() => {
    const tracked = trackedImages
      .filter((img) => img.source_type === "docker" && img.image_name)
      .map((img) => img.image_name.split(":")[0]); // Remove tag for comparison
    return PREDEFINED_DOCKER_IMAGES.filter((image) => !tracked.includes(image))
      .map((image) => ({ value: image, label: image }));
  }, [trackedImages]);

  // Custom styles for react-select to match existing design
  const selectStyles = {
    control: (base, state) => ({
      ...base,
      border: `2px solid ${state.isFocused ? 'var(--dodger-blue)' : 'var(--border-color)'}`,
      borderRadius: '8px',
      backgroundColor: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      boxShadow: state.isFocused ? '0 0 0 3px rgba(0, 90, 156, 0.1)' : 'none',
      '&:hover': {
        borderColor: 'var(--dodger-blue)',
      },
    }),
    menu: (base) => ({
      ...base,
      backgroundColor: 'var(--bg-primary)',
      border: '2px solid var(--border-color)',
      borderRadius: '8px',
      zIndex: 9999,
    }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isFocused 
        ? 'var(--bg-secondary)' 
        : state.isSelected 
        ? 'var(--dodger-blue)' 
        : 'var(--bg-primary)',
      color: state.isSelected ? 'white' : 'var(--text-primary)',
      '&:active': {
        backgroundColor: 'var(--dodger-blue)',
      },
    }),
    input: (base) => ({
      ...base,
      color: 'var(--text-primary)',
    }),
    singleValue: (base) => ({
      ...base,
      color: 'var(--text-primary)',
    }),
    placeholder: (base) => ({
      ...base,
      color: 'var(--text-tertiary)',
    }),
  };

  // Clear error and reset form when modal opens or closes
  useEffect(() => {
    if (isOpen) {
      setError("");
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
    }
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const payload = {
        name: formData.name.trim(),
        sourceType: sourceType,
      };

      if (sourceType === "github") {
        if (usePredefined && selectedPredefinedRepo) {
          payload.githubRepo = selectedPredefinedRepo.value.trim();
        } else {
          payload.githubRepo = formData.githubRepo.trim();
        }
      } else {
        if (usePredefinedDocker && selectedPredefinedImage) {
          payload.imageName = selectedPredefinedImage.value.trim();
        } else {
          payload.imageName = formData.imageName.trim();
        }
      }

      // Add current version if provided
      if (formData.currentVersion.trim()) {
        payload.current_version = formData.currentVersion.trim();
      }

      const response = await axios.post(
        `${API_BASE_URL}/api/tracked-images`,
        payload
      );

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
        setError(response.data.error || "Failed to add tracked item");
      }
    } catch (err) {
      setError(
        err.response?.data?.error ||
          "Failed to add tracked item. Please try again."
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Tracked App</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label>Source Type *</label>
            <div className="auth-type-toggle">
              <button
                type="button"
                className={`auth-type-option ${
                  sourceType === "github" ? "active" : ""
                }`}
                onClick={() => {
                  if (!loading) {
                    setSourceType("github");
                    setUsePredefined(true);
                    setSelectedPredefinedRepo(null);
                    setSelectedPredefinedImage(null);
                  }
                }}
                disabled={loading}
                aria-pressed={sourceType === "github"}
              >
                <span className="auth-type-icon">🐙</span>
                <span>GitHub Repository</span>
              </button>
              <button
                type="button"
                className={`auth-type-option ${
                  sourceType === "docker" ? "active" : ""
                }`}
                onClick={() => {
                  if (!loading) {
                    setSourceType("docker");
                    setUsePredefinedDocker(true);
                    setSelectedPredefinedRepo(null);
                    setSelectedPredefinedImage(null);
                  }
                }}
                disabled={loading}
                aria-pressed={sourceType === "docker"}
              >
                <span className="auth-type-icon">🐳</span>
                <span>Docker Image</span>
              </button>
            </div>
          </div>

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

          {sourceType === "docker" ? (
            <>
              <div className="form-group">
                <label>Image Selection *</label>
                <div className="auth-type-toggle">
                  <button
                    type="button"
                    className={`auth-type-option ${
                      usePredefinedDocker ? "active" : ""
                    }`}
                    onClick={() => {
                      if (!loading) {
                        setUsePredefinedDocker(true);
                        setFormData({ ...formData, imageName: "" });
                      }
                    }}
                    disabled={loading}
                    aria-pressed={usePredefinedDocker}
                  >
                    <span>Predefined</span>
                  </button>
                  <button
                    type="button"
                    className={`auth-type-option ${
                      !usePredefinedDocker ? "active" : ""
                    }`}
                    onClick={() => {
                      if (!loading) {
                        setUsePredefinedDocker(false);
                        setSelectedPredefinedImage("");
                      }
                    }}
                    disabled={loading}
                    aria-pressed={!usePredefinedDocker}
                  >
                    <span>Manual Entry</span>
                  </button>
                </div>
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
                    Docker image name with optional tag (e.g., username/repo:tag)
                  </small>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="form-group">
                <label>Repository Selection *</label>
                <div className="auth-type-toggle">
                  <button
                    type="button"
                    className={`auth-type-option ${
                      usePredefined ? "active" : ""
                    }`}
                    onClick={() => {
                      if (!loading) {
                        setUsePredefined(true);
                        setFormData({ ...formData, githubRepo: "" });
                      }
                    }}
                    disabled={loading}
                    aria-pressed={usePredefined}
                  >
                    <span>Predefined</span>
                  </button>
                  <button
                    type="button"
                    className={`auth-type-option ${
                      !usePredefined ? "active" : ""
                    }`}
                    onClick={() => {
                      if (!loading) {
                        setUsePredefined(false);
                        setSelectedPredefinedRepo("");
                      }
                    }}
                    disabled={loading}
                    aria-pressed={!usePredefined}
                  >
                    <span>Manual Entry</span>
                  </button>
                </div>
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
              {loading ? "Adding..." : "Add Tracked App"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddTrackedImageModal;

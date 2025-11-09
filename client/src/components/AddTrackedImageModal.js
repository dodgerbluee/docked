/**
 * Add Tracked Image/Repository Modal
 * Popup form to add a new tracked image or GitHub repository
 */

import React, { useState, useEffect } from "react";
import axios from "axios";
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

function AddTrackedImageModal({ isOpen, onClose, onSuccess }) {
  const [sourceType, setSourceType] = useState("github"); // 'docker' or 'github'
  const [usePredefined, setUsePredefined] = useState(true); // For GitHub repos - default to predefined
  const [selectedPredefinedRepo, setSelectedPredefinedRepo] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    imageName: "",
    githubRepo: "",
    currentVersion: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      setSelectedPredefinedRepo("");
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
          payload.githubRepo = selectedPredefinedRepo.trim();
        } else {
          payload.githubRepo = formData.githubRepo.trim();
        }
      } else {
        payload.imageName = formData.imageName.trim();
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
                    setSelectedPredefinedRepo("");
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
                    setUsePredefined(false);
                    setSelectedPredefinedRepo("");
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
                  <select
                    id="predefinedRepo"
                    value={selectedPredefinedRepo}
                    onChange={(e) => setSelectedPredefinedRepo(e.target.value)}
                    required
                    disabled={loading}
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      fontSize: "1rem",
                      borderRadius: "8px",
                      border: "2px solid var(--border-color)",
                      background: "var(--bg-primary)",
                      color: "var(--text-primary)",
                      cursor: loading ? "not-allowed" : "pointer",
                      transition: "all 0.2s ease",
                      appearance: "none",
                      WebkitAppearance: "none",
                      MozAppearance: "none",
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 12px center",
                      paddingRight: "40px",
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = "var(--dodger-blue)";
                      e.target.style.boxShadow =
                        "0 0 0 3px rgba(0, 90, 156, 0.1)";
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = "var(--border-color)";
                      e.target.style.boxShadow = "none";
                    }}
                    onMouseEnter={(e) => {
                      if (!loading && document.activeElement !== e.target) {
                        e.target.style.borderColor = "var(--dodger-blue)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (document.activeElement !== e.target) {
                        e.target.style.borderColor = "var(--border-color)";
                      }
                    }}
                  >
                    <option value="">Select a repository...</option>
                    {PREDEFINED_GITHUB_REPOS.map((repo) => (
                      <option key={repo} value={repo}>
                        {repo}
                      </option>
                    ))}
                  </select>
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
                (sourceType === "docker" && !formData.imageName) ||
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

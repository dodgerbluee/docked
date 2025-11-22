import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import axios from "axios";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import LoadingSpinner from "../ui/LoadingSpinner";
import { API_BASE_URL } from "../../utils/api";
import styles from "./AssociateImagesModal.module.css";

/**
 * AssociateImagesModal Component
 * Allows selecting container images to associate with a repository access token
 */
const AssociateImagesModal = ({ isOpen, onClose, token }) => {
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && token) {
      fetchContainers();
      fetchAssociatedImages();
    } else {
      setContainers([]);
      setSelectedImages(new Set());
      setError(null);
    }
  }, [isOpen, token]);

  const fetchAssociatedImages = async () => {
    if (!token) return;

    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/repository-access-tokens/${token.id}/associated-images`
      );
      const associatedImageRepos = response.data.imageRepos || [];
      setSelectedImages(new Set(associatedImageRepos));
    } catch (err) {
      console.error("Error fetching associated images:", err);
      // Don't show error for this - just start with empty selection
      setSelectedImages(new Set());
    }
  };

  const fetchContainers = async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const response = await axios.get(`${API_BASE_URL}/api/containers`);
      const allContainers = response.data.containers || [];

      // Filter containers by registry matching the token provider
      const filteredContainers = allContainers.filter((container) => {
        const imageRepo = container.imageRepo || container.image || "";
        
        if (token.provider === "github") {
          // Match GitHub Container Registry (ghcr.io)
          return imageRepo.startsWith("ghcr.io/");
        } else if (token.provider === "gitlab") {
          // Match GitLab Container Registry
          return imageRepo.startsWith("registry.gitlab.com/");
        }
        return false;
      });

      // Get unique image repositories
      const uniqueImages = new Map();
      filteredContainers.forEach((container) => {
        const imageRepo = container.imageRepo || container.image || "";
        if (imageRepo && !uniqueImages.has(imageRepo)) {
          uniqueImages.set(imageRepo, {
            imageRepo,
            imageName: container.image || imageRepo,
            containerCount: 0,
          });
        }
      });

      // Count containers per image
      filteredContainers.forEach((container) => {
        const imageRepo = container.imageRepo || container.image || "";
        if (uniqueImages.has(imageRepo)) {
          uniqueImages.get(imageRepo).containerCount += 1;
        }
      });

      setContainers(Array.from(uniqueImages.values()));
    } catch (err) {
      console.error("Error fetching containers:", err);
      setError("Failed to fetch containers. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleImageToggle = (imageRepo) => {
    setSelectedImages((prev) => {
      const next = new Set(prev);
      if (next.has(imageRepo)) {
        next.delete(imageRepo);
      } else {
        next.add(imageRepo);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedImages.size === containers.length) {
      setSelectedImages(new Set());
    } else {
      setSelectedImages(new Set(containers.map((img) => img.imageRepo)));
    }
  };

  const handleSave = async () => {
    if (!token || selectedImages.size === 0) return;

    setSaving(true);
    setError(null);

    try {
      // TODO: Implement API endpoint for associating images with tokens
      await axios.post(`${API_BASE_URL}/api/repository-access-tokens/${token.id}/associate-images`, {
        imageRepos: Array.from(selectedImages),
      });

      onClose();
    } catch (err) {
      console.error("Error associating images:", err);
      setError(err.response?.data?.error || "Failed to associate images. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!token) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Associate Images with ${token.name || token.provider}`}
      size="lg"
    >
      <div className={styles.modalContent}>
        {loading ? (
          <div className={styles.loadingContainer}>
            <LoadingSpinner size="md" message="Loading images..." />
          </div>
        ) : error && !loading ? (
          <div className={styles.errorContainer}>
            <p className={styles.errorText}>{error}</p>
            <Button onClick={fetchContainers} variant="outline" size="sm">
              Retry
            </Button>
          </div>
        ) : containers.length === 0 ? (
          <div className={styles.emptyContainer}>
            <p className={styles.emptyText}>
              No {token.provider === "github" ? "GitHub" : "GitLab"} images found in your containers.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.header}>
              <p className={styles.description}>
                Select images that should use this token when checking for updates.
              </p>
              <Button
                onClick={handleSelectAll}
                variant="outline"
                size="sm"
                disabled={saving}
              >
                {selectedImages.size === containers.length ? "Deselect All" : "Select All"}
              </Button>
            </div>

            <div className={styles.imagesList}>
              {containers.map((image) => (
                <div key={image.imageRepo} className={styles.imageItem}>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={selectedImages.has(image.imageRepo)}
                      onChange={() => handleImageToggle(image.imageRepo)}
                      disabled={saving}
                      aria-label={`Select ${image.imageRepo}`}
                    />
                  </label>
                  <div className={styles.imageInfo}>
                    <span className={styles.imageName}>{image.imageRepo}</span>
                    <span className={styles.imageCount}>
                      {image.containerCount} container{image.containerCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <div className={styles.errorContainer}>
                <p className={styles.errorText}>{error}</p>
              </div>
            )}

            <div className={styles.footer}>
              <Button onClick={onClose} variant="outline" disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                variant="primary"
                disabled={saving || selectedImages.size === 0}
              >
                {saving ? "Saving..." : `Save (${selectedImages.size})`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

AssociateImagesModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  token: PropTypes.shape({
    id: PropTypes.number.isRequired,
    name: PropTypes.string,
    provider: PropTypes.oneOf(["github", "gitlab"]).isRequired,
  }),
};

export default AssociateImagesModal;


import React, { useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import LoadingSpinner from "../ui/LoadingSpinner";
import { graphqlClient } from "../../graphql/client";
import { fetchContainersGraphql } from "../../graphql/containers";
import { TOKEN_ASSOCIATED_IMAGES_QUERY, ASSOCIATE_IMAGES_MUTATION } from "../../graphql/queries";
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

  // The modal stays mounted while `token` changes (the parent only flips
  // isOpen), so a response for the previous token can land after the new
  // token's requests have already started. Every request captures the token
  // it was made for plus the request sequence number that was live when it
  // started, and drops its result once either one has moved on — otherwise
  // the old token's container list/selection would populate the new token,
  // and saving would submit that stale selection under the new token's id.
  const tokenKey = token ? String(token.id) : null;
  const activeTokenKeyRef = useRef(tokenKey);
  const requestSeqRef = useRef(0);
  // True when the current token's existing associations could not be loaded.
  const assocLoadFailedRef = useRef(false);
  // The association list arrives after the container list, so the modal can be
  // fully rendered while it is still in flight. Saving then sends the empty
  // initial selection, and the input replaces the whole association set.
  const [assocLoading, setAssocLoading] = useState(false);

  const isRequestCurrent = useCallback((key, seq) => {
    return seq === requestSeqRef.current && activeTokenKeyRef.current === key;
  }, []);

  const fetchAssociatedImages = useCallback(async () => {
    if (!token) return;

    const key = String(token.id);
    const seq = requestSeqRef.current;

    setAssocLoading(true);
    try {
      const { data, error: gqlError } = await graphqlClient
        .query(TOKEN_ASSOCIATED_IMAGES_QUERY)
        .toPromise();
      if (gqlError) throw new Error(gqlError.message);
      if (!isRequestCurrent(key, seq)) return;
      const entry = (data?.repositoryTokens || []).find((t) => String(t.id) === String(token.id));
      const associatedImageRepos = (entry?.associatedImages || []).map((i) => i.imageRepo);
      assocLoadFailedRef.current = false;
      setSelectedImages(new Set(associatedImageRepos));
      setAssocLoading(false);
    } catch (err) {
      console.error("Error fetching associated images:", err);
      // The save replaces the whole association set, so a failed load that
      // looks like "nothing is associated" would silently wipe the existing
      // links the moment the user presses Save. Remember the failure and
      // block the save until the load succeeds.
      if (isRequestCurrent(key, seq)) {
        assocLoadFailedRef.current = true;
        setSelectedImages(new Set());
        setAssocLoading(false);
        setError(
          "Failed to load the current image associations. Saving is disabled until they load."
        );
      }
    }
  }, [token, isRequestCurrent]);

  const fetchContainers = useCallback(async () => {
    if (!token) return;

    const key = String(token.id);
    const seq = requestSeqRef.current;

    setLoading(true);
    setError(null);

    try {
      const { containers: allContainers } = await fetchContainersGraphql();

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

      if (!isRequestCurrent(key, seq)) return;
      setContainers(Array.from(uniqueImages.values()));
    } catch (err) {
      console.error("Error fetching containers:", err);
      if (isRequestCurrent(key, seq)) {
        setError("Failed to fetch containers. Please try again.");
      }
    } finally {
      if (isRequestCurrent(key, seq)) {
        setLoading(false);
      }
    }
  }, [token, isRequestCurrent]);

  useEffect(() => {
    // New target (or re-open): retire anything still in flight for the old one.
    activeTokenKeyRef.current = tokenKey;
    requestSeqRef.current += 1;

    if (isOpen && token) {
      setSaving(false);
      setAssocLoading(true);
      fetchContainers();
      fetchAssociatedImages();
    } else {
      setContainers([]);
      setSelectedImages(new Set());
      setError(null);
      setAssocLoading(false);
    }
  }, [isOpen, token, tokenKey, fetchContainers, fetchAssociatedImages]);

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
    // An empty selection is meaningful: the input replaces the association set,
    // so zero selections is the only way to clear every image from a token.
    if (!token) return;
    // ...but an empty selection that came from a FAILED load is not a user
    // intent to clear: refuse rather than wipe associations we never saw.
    if (assocLoadFailedRef.current) {
      setError("Image associations failed to load - close and reopen the modal to retry.");
      return;
    }
    if (assocLoading) {
      setError("Image associations are still loading - please wait before saving.");
      return;
    }

    const key = String(token.id);
    const seq = requestSeqRef.current;
    const imageRepos = Array.from(selectedImages);

    setSaving(true);
    setError(null);

    try {
      const { data, error: gqlError } = await graphqlClient
        .mutation(ASSOCIATE_IMAGES_MUTATION, {
          tokenId: key,
          input: { imageRepos },
        })
        .toPromise();
      if (gqlError) throw new Error(gqlError.message);
      // The payload carries its own verdict; without this a refused save still
      // closed the modal and the associations silently disappeared.
      if (!data?.associateImages?.success) {
        throw new Error(data?.associateImages?.message || "Failed to associate images");
      }

      // The modal may have been re-pointed at another token (or closed) while
      // the save was in flight; closing then would dismiss the new target.
      if (!isRequestCurrent(key, seq)) return;
      onClose();
    } catch (err) {
      console.error("Error associating images:", err);
      if (isRequestCurrent(key, seq)) {
        setError(err.message || "Failed to associate images. Please try again.");
      }
    } finally {
      if (isRequestCurrent(key, seq)) {
        setSaving(false);
      }
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
              No {token.provider === "github" ? "GitHub" : "GitLab"} images found in your
              containers.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.header}>
              <p className={styles.description}>
                Select images that should use this token when checking for updates.
              </p>
              <Button onClick={handleSelectAll} variant="outline" size="sm" disabled={saving}>
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
                disabled={saving || assocLoading}
                title={
                  assocLoading
                    ? "Waiting for the current associations to load"
                    : selectedImages.size === 0
                      ? "Save with no images selected to clear all associations"
                      : undefined
                }
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

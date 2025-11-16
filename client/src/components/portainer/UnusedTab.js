import React, { useState } from "react";
import PropTypes from "prop-types";
import { Trash2 } from "lucide-react";
import { formatTimeAgo } from "../../utils/formatters";
import LoadingSpinner from "../ui/LoadingSpinner";
import EmptyState from "../ui/EmptyState";
import ConfirmDialog from "../ui/ConfirmDialog";
import styles from "./UnusedTab.module.css";

/**
 * UnusedTab Component
 * Displays unused Docker images
 */
const UnusedTab = React.memo(function UnusedTab({
  unusedImages,
  isLoading,
  hasData,
  selectedImages,
  deletingImages,
  formatBytes,
  onToggleImageSelect,
  onDeleteImage,
  executeDeleteImage,
  onDeleteImages,
  executeDeleteImages,
  collapsedUnusedImages,
  onToggleCollapsed,
}) {
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  if (isLoading && !hasData) {
    return (
      <LoadingSpinner
        size="md"
        message="Loading image data from Portainer..."
        className={styles.loadingState}
      />
    );
  }

  if (unusedImages.length === 0) {
    return (
      <EmptyState
        message={
          hasData
            ? "No unused images found."
            : "No unused images found. Data will appear once fetched from Portainer."
        }
        className={styles.emptyState}
      />
    );
  }

  const totalSize = unusedImages.reduce((sum, img) => sum + (img.size || 0), 0);

  const handleDeleteClick = (image) => {
    const deleteData = onDeleteImage(image);
    if (deleteData) {
      setDeleteConfirm(deleteData);
    }
  };

  const handleDeleteConfirm = async () => {
    if (deleteConfirm?.image) {
      await executeDeleteImage(deleteConfirm.image);
      setDeleteConfirm(null);
    }
  };

  return (
    <div className={styles.contentTabPanel}>
      <div className={styles.stackGroup}>
        <div
          className={styles.stackHeader}
          onClick={onToggleCollapsed}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggleCollapsed();
            }
          }}
          role="button"
          tabIndex={0}
          aria-expanded={!collapsedUnusedImages}
          aria-label={`Unused Images - ${collapsedUnusedImages ? "Expand" : "Collapse"}`}
        >
          <div className={styles.stackHeaderLeft}>
            <button
              className={styles.stackToggle}
              aria-label={collapsedUnusedImages ? "Expand unused images" : "Collapse unused images"}
              aria-hidden="true"
              tabIndex={-1}
            >
              {collapsedUnusedImages ? "▶" : "▼"}
            </button>
            <h3 className={styles.stackName}>Unused Images</h3>
          </div>
          <span className={styles.stackCount}>
            {unusedImages.length} image{unusedImages.length !== 1 ? "s" : ""}
            {" • "}
            {formatBytes(totalSize)}
          </span>
        </div>
        {!collapsedUnusedImages && (
          <>
            <div className={styles.imagesGrid}>
              {unusedImages.map((image) => (
                <div
                  key={image.id}
                  className={`${styles.imageCard} ${!deletingImages ? styles.clickableCard : ""}`}
                  onClick={(e) => {
                    // Don't trigger if clicking on interactive elements
                    const target = e.target;
                    const isInteractiveElement =
                      target.tagName === "A" ||
                      target.tagName === "INPUT" ||
                      target.closest("a") ||
                      target.closest("label") ||
                      target.closest(`.${styles.checkbox}`) ||
                      target.closest(`.${styles.deleteIcon}`) ||
                      target.closest(`.${styles.portainerBadge}`);

                    if (!deletingImages && !isInteractiveElement) {
                      handleDeleteClick(image);
                    }
                  }}
                >
                  <div className={styles.cardHeader}>
                    <div className={styles.headerLeft}>
                      <h3
                        title={
                          image.repoTags && image.repoTags.length > 0
                            ? image.repoTags[0].replace(/:<none>$/, "")
                            : "<none>"
                        }
                      >
                        {image.repoTags && image.repoTags.length > 0
                          ? image.repoTags[0].replace(/:<none>$/, "")
                          : "<none>"}
                      </h3>
                    </div>
                    <label className={styles.checkbox} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedImages.has(image.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          onToggleImageSelect(image.id);
                        }}
                        disabled={deletingImages}
                      />
                    </label>
                  </div>
                  <div className={styles.cardBody}>
                    <div className={styles.portainerSection}>
                      {image.portainerName && (
                        <>
                          {image.portainerUrl ? (
                            <a
                              href={image.portainerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.portainerBadge}
                              title={`Open Portainer instance: ${image.portainerName}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {image.portainerName}
                            </a>
                          ) : (
                            <span
                              className={styles.portainerBadge}
                              title={`Portainer instance: ${image.portainerName}`}
                            >
                              {image.portainerName}
                            </span>
                          )}
                          <span
                            className={`${styles.deleteIcon} ${deletingImages ? styles.disabled : ""}`}
                            title={deletingImages ? "Deleting..." : "Delete Image"}
                            aria-label={deletingImages ? "Deleting..." : "Delete Image"}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!deletingImages) {
                                handleDeleteClick(image);
                              }
                            }}
                          >
                            <Trash2 size={14} />
                          </span>
                        </>
                      )}
                    </div>
                    {image.repoTags && image.repoTags.length > 1 && (
                      <p className={styles.metaItem}>
                        <strong>Tags:</strong> {image.repoTags.slice(1).join(", ")}
                      </p>
                    )}
                    <p className={styles.metaItem}>
                      <strong>Size:</strong> {formatBytes(image.size)}
                    </p>
                    {image.created && (
                      <p className={styles.metaItem}>
                        <strong>Created:</strong>{" "}
                        {formatTimeAgo(
                          typeof image.created === "number"
                            ? new Date(image.created * 1000).toISOString()
                            : image.created
                        )}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Image?"
        message={`Delete image ${deleteConfirm?.imageName?.replace(/:<none>$/, "") || ""}? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
});

UnusedTab.propTypes = {
  unusedImages: PropTypes.arrayOf(PropTypes.object).isRequired,
  isLoading: PropTypes.bool.isRequired,
  hasData: PropTypes.bool.isRequired,
  selectedImages: PropTypes.instanceOf(Set).isRequired,
  deletingImages: PropTypes.bool.isRequired,
  formatBytes: PropTypes.func.isRequired,
  onToggleImageSelect: PropTypes.func.isRequired,
  onDeleteImage: PropTypes.func.isRequired,
  executeDeleteImage: PropTypes.func.isRequired,
  onDeleteImages: PropTypes.func.isRequired,
  executeDeleteImages: PropTypes.func.isRequired,
  collapsedUnusedImages: PropTypes.bool.isRequired,
  onToggleCollapsed: PropTypes.func.isRequired,
};

UnusedTab.displayName = "UnusedTab";

export default UnusedTab;

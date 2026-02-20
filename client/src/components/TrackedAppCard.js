/**
 * TrackedAppCard Component
 * Reusable card component for displaying a tracked app (Docker image, GitHub repo, or GitLab repo)
 */

import React, { useMemo, useCallback } from "react";
import PropTypes from "prop-types";
import { Pencil, Check } from "lucide-react";
import { getDockerHubRepoUrl } from "../utils/formatters";
import GitHubIcon from "./icons/GitHubIcon";
import GitLabIcon from "./icons/GitLabIcon";
import Button from "./ui/Button";
import styles from "./TrackedAppCard.module.css";

const DOCKER_ICON_SRC = `${process.env.PUBLIC_URL || ""}/img/docker-mark-white.svg`;

/**
 * TrackedAppCard component
 * @param {Object} image - Tracked image data
 * @param {Function} onEdit - Handler for edit action
 * @param {Function} onUpgrade - Handler for upgrade action
 * @param {boolean} selected - Whether the card is selected
 * @param {Function} onToggleSelect - Handler for toggling selection
 */
const TrackedAppCard = React.memo(function TrackedAppCard({
  image,
  onEdit,
  onUpgrade,
  selected = false,
  onToggleSelect,
}) {
  // Memoize computed values
  const hasNoLatestVersion = useMemo(
    () =>
      !image.latest_version ||
      image.latest_version === "Unknown" ||
      image.latest_version.trim() === "",
    [image.latest_version]
  );

  const subheaderText =
    (image.source_type === "github" || image.source_type === "gitlab") && image.github_repo
      ? image.github_repo
      : image.github_repo || image.image_name;

  // Construct GitHub/GitLab release URL for a version
  const getVersionReleaseUrl = (version) => {
    if (!version || version === "Not set" || !image.github_repo) return null;
    // Use releaseUrl if available (for latest version), otherwise construct it
    if (version === image.latest_version && image.releaseUrl) {
      return image.releaseUrl;
    }
    // Construct URL based on source type
    if (image.source_type === "gitlab") {
      const repoUrl = image.github_repo.startsWith("http")
        ? image.github_repo.replace(/\/$/, "")
        : `https://gitlab.com/${image.github_repo}`;
      return `${repoUrl}/-/releases/${version}`;
    } else {
      // GitHub
      const repoUrl = image.github_repo.startsWith("http")
        ? image.github_repo
        : `https://github.com/${image.github_repo}`;
      return `${repoUrl}/releases/tag/${version}`;
    }
  };

  const publishDate = useMemo(() => {
    if (image.source_type === "github" || image.source_type === "gitlab") {
      if (image.latest_version && image.has_update && image.latestVersionPublishDate) {
        return image.latestVersionPublishDate;
      } else if (image.currentVersionPublishDate) {
        return image.currentVersionPublishDate;
      }
    } else {
      // Docker Hub: show latest version publish date if there's an update, otherwise current version publish date
      if (image.latest_version && image.has_update && image.latestVersionPublishDate) {
        return image.latestVersionPublishDate;
      } else if (image.currentVersionPublishDate) {
        return image.currentVersionPublishDate;
      }
    }
    return null;
  }, [
    image.source_type,
    image.latest_version,
    image.has_update,
    image.latestVersionPublishDate,
    image.currentVersionPublishDate,
  ]);

  // Memoize event handlers
  const handleEdit = useCallback(
    (e) => {
      if (e) {
        e.stopPropagation();
      }
      onEdit(image);
    },
    [image, onEdit]
  );

  const handleUpgrade = useCallback(() => {
    onUpgrade(image.id, image.latest_version, image.name);
  }, [image.id, image.latest_version, image.name, onUpgrade]);

  // Check if current version is not available
  // Only show red if the app has been checked (last_checked exists) and got a bad response
  // New apps that haven't been checked yet should show blue (default state)
  const hasNoCurrentVersion = useMemo(() => {
    // Only consider it "not available" if the app has been checked
    if (!image.last_checked) {
      return false; // Not checked yet, use default blue
    }
    // Has been checked, now check if current version is unavailable
    return (
      !image.current_version ||
      image.current_version === "Not set" ||
      image.current_version === "Unknown" ||
      (typeof image.current_version === "string" && image.current_version.trim() === "")
    );
  }, [image.current_version, image.last_checked]);

  // Only show red border (unknownBorder) if the app has been checked and has no latest version
  // New apps that haven't been checked yet should show blue (default state)
  const shouldShowUnknownBorder = useMemo(() => {
    // Only show unknown border if app has been checked and has no latest version
    return image.last_checked && hasNoLatestVersion && !image.has_update;
  }, [image.last_checked, hasNoLatestVersion, image.has_update]);

  // Handle card click - mark as upgraded if it has an update
  const handleCardClick = useCallback(() => {
    if (image.has_update && onUpgrade) {
      handleUpgrade();
    }
  }, [image.has_update, onUpgrade, handleUpgrade]);

  return (
    <div
      className={`${styles.card} ${
        shouldShowUnknownBorder ? styles.unknownBorder : ""
      } ${image.has_update ? styles.updateAvailable : hasNoCurrentVersion ? styles.noCurrentVersion : styles.noUpdate} ${image.has_update ? styles.clickableCard : ""}`}
      onClick={image.has_update ? handleCardClick : undefined}
      style={image.has_update ? { cursor: "pointer" } : undefined}
      role={image.has_update ? "button" : undefined}
      tabIndex={image.has_update ? 0 : undefined}
      onKeyDown={(e) => {
        if (image.has_update && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          handleCardClick();
        }
      }}
      aria-label={image.has_update ? `Mark ${image.name} as upgraded` : undefined}
    >
      <div className={styles.content}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.name} title={image.name}>
              {image.name}
            </span>
          </div>
          {image.has_update && onToggleSelect && (
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(image.id)}
                aria-label={`Select ${image.name} for upgrade`}
              />
            </label>
          )}
        </div>

        <div className={`${styles.repoInfo} ${image.has_update ? styles.repoInfoWithUpdates : ""}`}>
          <div className={styles.repoInfoLeft}>
            {(image.source_type === "github" || image.source_type === "gitlab") &&
            image.github_repo ? (
              <a
                href={
                  image.github_repo.startsWith("http")
                    ? image.github_repo
                    : image.source_type === "gitlab"
                      ? `https://gitlab.com/${image.github_repo}`
                      : `https://github.com/${image.github_repo}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className={styles.repoName}
                title={subheaderText}
                onClick={(e) => e.stopPropagation()}
              >
                {subheaderText}
              </a>
            ) : (
              <span className={styles.repoName} title={subheaderText}>
                {subheaderText}
              </span>
            )}
          </div>

          <div className={styles.iconGroup}>
            {image.source_type === "github" && image.github_repo && (
              <>
                <a
                  href={
                    image.github_repo.startsWith("http")
                      ? image.github_repo
                      : `https://github.com/${image.github_repo}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.githubIconLink}
                  title="Open GitHub repository"
                  aria-label="Open GitHub repository"
                  onClick={(e) => e.stopPropagation()}
                >
                  <GitHubIcon size={18} />
                </a>
                <Button
                  onClick={handleEdit}
                  variant="outline"
                  size="sm"
                  title="Edit"
                  aria-label="Edit"
                  className={styles.editButton}
                >
                  <Pencil size={14} className={styles.editIcon} />
                </Button>
                {image.has_update && (
                  <span
                    className={styles.upgradedCheckmark}
                    title="Mark Upgraded"
                    aria-label="Mark Upgraded"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUpgrade();
                    }}
                  >
                    <Check size={18} />
                  </span>
                )}
              </>
            )}
            {image.source_type === "gitlab" && image.github_repo && (
              <>
                <a
                  href={
                    image.github_repo.startsWith("http")
                      ? image.github_repo
                      : `https://gitlab.com/${image.github_repo}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.githubIconLink}
                  title="Open GitLab repository"
                  aria-label="Open GitLab repository"
                  onClick={(e) => e.stopPropagation()}
                >
                  <GitLabIcon size={18} />
                </a>
                <Button
                  onClick={handleEdit}
                  variant="outline"
                  size="sm"
                  title="Edit"
                  aria-label="Edit"
                  className={styles.editButton}
                >
                  <Pencil size={14} className={styles.editIcon} />
                </Button>
                {image.has_update && (
                  <span
                    className={styles.upgradedCheckmark}
                    title="Mark Upgraded"
                    aria-label="Mark Upgraded"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUpgrade();
                    }}
                  >
                    <Check size={18} />
                  </span>
                )}
              </>
            )}
            {(!image.source_type || image.source_type === "docker") && image.image_name && (
              <>
                <a
                  href={getDockerHubRepoUrl(image.image_name) || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.dockerIconLink}
                  title="Open Docker Hub repository"
                  aria-label="Open Docker Hub repository"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!getDockerHubRepoUrl(image.image_name)) {
                      e.preventDefault();
                    }
                  }}
                >
                  <img src={DOCKER_ICON_SRC} alt="Docker" className={styles.dockerIconSmall} />
                </a>
                <Button
                  onClick={handleEdit}
                  variant="outline"
                  size="sm"
                  title="Edit"
                  aria-label="Edit"
                  className={styles.editButton}
                >
                  <Pencil size={14} className={styles.editIcon} />
                </Button>
                {image.has_update && (
                  <span
                    className={styles.upgradedCheckmark}
                    title="Mark Upgraded"
                    aria-label="Mark Upgraded"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUpgrade();
                    }}
                  >
                    <Check size={18} />
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <div className={styles.versionInfo}>
          {image.latest_version && image.has_update && (
            <p className={styles.metaItem}>
              <strong>Latest:</strong>{" "}
              {(image.source_type === "github" || image.source_type === "gitlab") &&
              getVersionReleaseUrl(image.latest_version) ? (
                <a
                  href={getVersionReleaseUrl(image.latest_version)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.versionLink}
                  title={image.latest_version}
                  onClick={(e) => e.stopPropagation()}
                >
                  {image.latest_version}
                </a>
              ) : (
                <span title={image.latest_version}>{image.latest_version}</span>
              )}
            </p>
          )}
          <p className={styles.metaItem}>
            <strong>Current:</strong>{" "}
            {(image.source_type === "github" || image.source_type === "gitlab") &&
            getVersionReleaseUrl(image.current_version) ? (
              <a
                href={getVersionReleaseUrl(image.current_version)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.versionLink}
                title={image.current_version || "Not set"}
                onClick={(e) => e.stopPropagation()}
              >
                {image.current_version || "Not set"}
              </a>
            ) : (
              <span title={image.current_version || "Not set"}>
                {image.current_version || "Not set"}
              </span>
            )}
          </p>
          {publishDate ? (
            <p className={styles.metaItem}>
              <strong>Released:</strong> {new Date(publishDate).toLocaleDateString()}
            </p>
          ) : image.current_version || image.latest_version ? (
            <p className={styles.metaItem}>
              <strong>Released:</strong> <span className={styles.unavailable}>Not available</span>
            </p>
          ) : null}

          {image.releaseUrl && (
            <p className={styles.metaItem}>
              <strong>Release:</strong>{" "}
              <a
                href={image.releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.versionLink}
                onClick={(e) => e.stopPropagation()}
              >
                View
              </a>
            </p>
          )}
        </div>
      </div>
    </div>
  );
});

TrackedAppCard.propTypes = {
  image: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    name: PropTypes.string.isRequired,
    github_repo: PropTypes.string,
    image_name: PropTypes.string,
    current_version: PropTypes.string,
    latest_version: PropTypes.string,
    has_update: PropTypes.bool,
    source_type: PropTypes.oneOf(["github", "gitlab", "docker"]),
    releaseUrl: PropTypes.string,
    latestVersionPublishDate: PropTypes.string,
    currentVersionPublishDate: PropTypes.string,
    last_checked: PropTypes.string,
  }).isRequired,
  onEdit: PropTypes.func.isRequired,
  onUpgrade: PropTypes.func.isRequired,
  selected: PropTypes.bool,
  onToggleSelect: PropTypes.func,
};

export default TrackedAppCard;

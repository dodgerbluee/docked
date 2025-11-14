import React, { useCallback } from "react";
import PropTypes from "prop-types";
import { HardDriveDownload } from "lucide-react";
import {
  getDockerHubUrl,
  getDockerHubTagsUrl,
  getDockerHubRepoUrl,
  formatTimeAgo,
} from "../../utils/formatters";
import { showToast } from "../../utils/toast";
import { PORTAINER_CONTAINER_MESSAGE } from "../../constants/portainerPage";
import Button from "../ui/Button";
import GitHubIcon from "../icons/GitHubIcon";
import styles from "./PortainerContainerCard.module.css";

/**
 * PortainerContainerCard Component
 * Displays a container card with Portainer page specific styling
 */
const PortainerContainerCard = React.memo(function PortainerContainerCard({
  container,
  isPortainer,
  selected,
  upgrading,
  showUpdates,
  onToggleSelect,
  onUpgrade,
}) {
  // Extract version/tag from image name
  const extractVersion = (imageName) => {
    if (!imageName) return "latest";
    if (imageName.includes(":")) {
      const parts = imageName.split(":");
      return parts[parts.length - 1]; // Get the last part after the last colon
    }
    return "latest"; // No version specified, default to "latest"
  };

  // Extract image name without version/tag
  const extractImageName = (imageName) => {
    if (!imageName) return imageName;
    if (imageName.includes(":")) {
      const parts = imageName.split(":");
      return parts.slice(0, -1).join(":"); // Get everything except the last part
    }
    return imageName; // No version, return as-is
  };

  const imageVersion = extractVersion(container.image);
  const imageNameWithoutVersion = extractImageName(container.image);

  // Check if image is from GitHub Container Registry (starts with ghcr.io AND not found on Docker Hub)
  const isGitHubContainer = container.image && 
    container.image.startsWith("ghcr.io/") && 
    container.existsInDockerHub === false;
  const isDockerHub = container.existsInDockerHub !== false && !isGitHubContainer;

  // Get GitHub Container Registry URL
  const getGitHubContainerUrl = (imageName) => {
    if (!imageName || !imageName.startsWith("ghcr.io/")) return null;
    // Remove version/tag if present
    const imageWithoutVersion = extractImageName(imageName);
    return `https://${imageWithoutVersion}`;
  };

  // Truncate version to 25 characters
  const truncateVersion = (version) => {
    if (!version) return version;
    if (version.length <= 25) return version;
    return version.substring(0, 25) + "...";
  };

  // Truncate current version/digest to 10 characters
  const truncateCurrentVersion = (version) => {
    if (!version) return version;
    if (version.length <= 10) return version;
    return version.substring(0, 10);
  };

  // Truncate image name to 30 characters
  const truncateImageName = (name) => {
    if (!name) return name;
    if (name.length <= 30) return name;
    return name.substring(0, 30) + "...";
  };

  // Truncate container name to 25 characters
  const truncateContainerName = (name) => {
    if (!name) return name;
    if (name.length <= 25) return name;
    return name.substring(0, 25) + "...";
  };

  const truncatedVersion = truncateVersion(imageVersion);
  const truncatedImageName = truncateImageName(imageNameWithoutVersion);
  const truncatedContainerName = truncateContainerName(container.name);

  // Copy version to clipboard
  const handleVersionClick = useCallback(async (e) => {
    e.stopPropagation();
    if (imageVersion) {
      try {
        await navigator.clipboard.writeText(imageVersion);
        showToast("Version text copied", "info");
      } catch (err) {
        console.error("Failed to copy version to clipboard:", err);
        showToast("Failed to copy version", "error");
      }
    }
  }, [imageVersion]);

  // Copy container name to clipboard
  const handleContainerNameClick = useCallback(async (e) => {
    e.stopPropagation();
    if (container.name) {
      try {
        await navigator.clipboard.writeText(container.name);
        showToast("Container name copied", "info");
      } catch (err) {
        console.error("Failed to copy container name to clipboard:", err);
        showToast("Failed to copy container name", "error");
      }
    }
  }, [container.name]);

  // Open Docker Hub or GitHub Container Registry link for image name
  const handleImageNameClick = useCallback((e) => {
    e.stopPropagation();
    if (container.image) {
      if (isGitHubContainer) {
        const githubUrl = getGitHubContainerUrl(container.image);
        if (githubUrl) {
          window.open(githubUrl, "_blank", "noopener,noreferrer");
        }
      } else if (isDockerHub) {
        const dockerHubUrl = getDockerHubRepoUrl(container.image);
        if (dockerHubUrl) {
          window.open(dockerHubUrl, "_blank", "noopener,noreferrer");
        }
      }
    }
  }, [container.image, isGitHubContainer, isDockerHub]);

  return (
    <div
      className={`${styles.containerCard} ${
        showUpdates ? styles.updateAvailable : ""
      } ${isPortainer ? styles.portainerDisabled : ""}`}
      title={isPortainer ? PORTAINER_CONTAINER_MESSAGE : undefined}
      role="article"
      aria-label={`Container ${container.name}`}
    >
      <div className={styles.cardHeader} title={isPortainer ? PORTAINER_CONTAINER_MESSAGE : undefined}>
        <div className={styles.headerLeft}>
          <h3 
            className={styles.containerName}
            title={container.name}
            onClick={handleContainerNameClick}
          >
            {truncatedContainerName}
          </h3>
        </div>
        {showUpdates && (
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(container.id)}
              disabled={upgrading || isPortainer}
              title={isPortainer ? PORTAINER_CONTAINER_MESSAGE : undefined}
              aria-label={`Select ${container.name} for upgrade`}
            />
          </label>
        )}
      </div>
      <div className={styles.cardBody} title={isPortainer ? PORTAINER_CONTAINER_MESSAGE : undefined}>
        <div className={styles.imageHeaderContainer}>
          <div className={styles.imageHeaderLeft}>
            <h4 
              className={styles.imageHeader} 
              title={imageNameWithoutVersion}
              onClick={handleImageNameClick}
            >
              {truncatedImageName}
            </h4>
            {!showUpdates && container.image && (isDockerHub || isGitHubContainer) && (
              <div className={styles.iconGroup}>
                {isDockerHub ? (
                  <a
                    href={getDockerHubRepoUrl(container.image) || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.dockerIconLink}
                    title="Open Docker Hub repository"
                    aria-label="Open Docker Hub repository"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!getDockerHubRepoUrl(container.image)) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <img
                      src="/img/docker-mark-white.svg"
                      alt="Docker"
                      className={styles.dockerIconSmall}
                    />
                  </a>
                ) : isGitHubContainer ? (
                  <a
                    href={getGitHubContainerUrl(container.image) || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.githubIconLink}
                    title="Open GitHub Container Registry"
                    aria-label="Open GitHub Container Registry"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!getGitHubContainerUrl(container.image)) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <GitHubIcon size={14} />
                  </a>
                ) : null}
              </div>
            )}
          </div>
          {showUpdates && container.image && (isDockerHub || isGitHubContainer) && (
            <div className={styles.iconGroup}>
              {isDockerHub ? (
                <a
                  href={getDockerHubRepoUrl(container.image) || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.dockerIconLink}
                  title="Open Docker Hub repository"
                  aria-label="Open Docker Hub repository"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!getDockerHubRepoUrl(container.image)) {
                      e.preventDefault();
                    }
                  }}
                >
                  <img
                    src="/img/docker-mark-white.svg"
                    alt="Docker"
                    className={styles.dockerIconSmall}
                  />
                </a>
              ) : isGitHubContainer ? (
                <a
                  href={getGitHubContainerUrl(container.image) || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.githubIconLink}
                  title="Open GitHub Container Registry"
                  aria-label="Open GitHub Container Registry"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!getGitHubContainerUrl(container.image)) {
                      e.preventDefault();
                    }
                  }}
                >
                  <GitHubIcon size={14} />
                </a>
              ) : null}
              {showUpdates && (
                <span
                  className={`${styles.upgradeCheckmark} ${(isPortainer || upgrading) ? styles.disabled : ''}`}
                  title={isPortainer ? PORTAINER_CONTAINER_MESSAGE : upgrading ? "Upgrading..." : "Upgrade"}
                  aria-label={isPortainer ? PORTAINER_CONTAINER_MESSAGE : upgrading ? "Upgrading..." : "Upgrade"}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isPortainer && !upgrading) {
                      onUpgrade(container);
                    }
                  }}
                >
                  <HardDriveDownload size={14} />
                </span>
              )}
            </div>
          )}
        </div>
        {showUpdates && container.portainerName && (
          container.portainerUrl ? (
            <a
              href={container.portainerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.portainerBadge}
              title={`Open Portainer instance: ${container.portainerName}`}
              onClick={(e) => e.stopPropagation()}
            >
              {container.portainerName}
            </a>
          ) : (
            <span className={styles.portainerBadge} title={`Portainer instance: ${container.portainerName}`}>
              {container.portainerName}
            </span>
          )
        )}
        {showUpdates && (
          <p className={styles.metaItem}>
            <strong>Version:</strong>{" "}
            <span 
              className={styles.versionText} 
              title={imageVersion}
              onClick={handleVersionClick}
            >
              {truncatedVersion}
            </span>
          </p>
        )}
        {showUpdates && container.latestPublishDate && (
          <p className={styles.metaItem}>
            <strong>Published:</strong> {formatTimeAgo(container.latestPublishDate)}
          </p>
        )}
        {!showUpdates && container.currentDigest && (
          <>
            {container.portainerName && (
              container.portainerUrl ? (
                <a
                  href={container.portainerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.portainerBadge}
                  title={`Open Portainer instance: ${container.portainerName}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {container.portainerName}
                </a>
              ) : (
                <span className={styles.portainerBadge} title={`Portainer instance: ${container.portainerName}`}>
                  {container.portainerName}
                </span>
              )
            )}
            <p className={styles.metaItem}>
              <strong>Version:</strong>{" "}
              <span 
                className={styles.versionText} 
                title={imageVersion}
                onClick={handleVersionClick}
              >
                {truncatedVersion}
              </span>
            </p>
            {container.currentImageCreated && (
              <p className={styles.metaItem}>
                <strong>Created:</strong>{" "}
                {formatTimeAgo(
                  typeof container.currentImageCreated === "number"
                    ? new Date(container.currentImageCreated * 1000).toISOString()
                    : container.currentImageCreated
                )}
              </p>
            )}
            <p className={styles.metaItem}>
              <strong>Current:</strong>{" "}
              <span className={styles.versionBadge}>
                <a
                  href={
                    container.currentTag || container.currentVersion
                      ? getDockerHubUrl(
                          container.image,
                          container.currentTag || container.currentVersion
                        )
                      : getDockerHubTagsUrl(container.image)
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className={styles.digestLink}
                  title={
                    container.currentTag || container.currentVersion
                      ? "View layer on Docker Hub"
                      : "View tags on Docker Hub"
                  }
                >
                  {container.currentDigest 
                    ? `sha256:${truncateCurrentVersion(container.currentDigest)}`
                    : truncateCurrentVersion(container.currentTag || container.currentVersion || 'latest')}
                </a>
              </span>
            </p>
            {container.currentVersionPublishDate && (
              <p className={styles.metaItem}>
                <strong>Published:</strong>{" "}
                {formatTimeAgo(container.currentVersionPublishDate)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
});

PortainerContainerCard.propTypes = {
  container: PropTypes.object.isRequired,
  isPortainer: PropTypes.bool.isRequired,
  selected: PropTypes.bool.isRequired,
  upgrading: PropTypes.bool.isRequired,
  showUpdates: PropTypes.bool.isRequired,
  onToggleSelect: PropTypes.func.isRequired,
  onUpgrade: PropTypes.func.isRequired,
};

PortainerContainerCard.displayName = "PortainerContainerCard";

export default PortainerContainerCard;


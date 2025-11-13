/**
 * TrackedAppCard Component
 * Reusable card component for displaying a tracked app (Docker image or GitHub repo)
 */

import React from 'react';
import PropTypes from 'prop-types';
import { Pencil } from 'lucide-react';
import { getDockerHubRepoUrl } from '../utils/formatters';
import styles from './TrackedAppCard.module.css';

/**
 * TrackedAppCard component
 * @param {Object} image - Tracked image data
 * @param {Function} onEdit - Handler for edit action
 * @param {Function} onUpgrade - Handler for upgrade action
 */
function TrackedAppCard({ image, onEdit, onUpgrade }) {
  // Check if there's no valid latest version
  const hasNoLatestVersion =
    !image.latest_version ||
    image.latest_version === 'Unknown' ||
    image.latest_version.trim() === '';

  // Determine border style
  let borderStyle = '1px solid var(--border-color)';
  if (hasNoLatestVersion) {
    borderStyle = '2px solid var(--text-secondary)';
  }

  // Get publish date for display
  const getPublishDate = () => {
    let publishDate = null;
    if (image.source_type === 'github') {
      if (
        image.latest_version &&
        image.has_update &&
        image.latestVersionPublishDate
      ) {
        publishDate = image.latestVersionPublishDate;
      } else if (image.currentVersionPublishDate) {
        publishDate = image.currentVersionPublishDate;
      }
    } else {
      publishDate = image.currentVersionPublishDate;
    }
    return publishDate;
  };

  const publishDate = getPublishDate();

  // Handle GitHub repo click
  const handleGitHubClick = () => {
    const repoUrl = image.github_repo.startsWith('http')
      ? image.github_repo
      : `https://github.com/${image.github_repo}`;
    window.open(repoUrl, '_blank', 'noopener,noreferrer');
  };

  // Handle Docker Hub click
  const handleDockerHubClick = () => {
    const dockerHubUrl = getDockerHubRepoUrl(image.image_name);
    if (dockerHubUrl) {
      window.open(dockerHubUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      className={`${styles.card} ${
        hasNoLatestVersion && !image.has_update ? styles.unknownBorder : ''
      }`}
      style={{ border: borderStyle }}
    >
      <div className={styles.content}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            {image.current_version &&
              image.latest_version &&
              image.current_version === image.latest_version && (
                <span className={styles.statusBadge} data-status="up-to-date">
                  ✓
                </span>
              )}
            {image.has_update && (
              <span
                className={styles.statusBadge}
                data-status="update-available"
                title="Update Available"
              >
                  !
                </span>
            )}
            <span className={styles.name}>{image.name}</span>
          </div>
        </div>

        <div className={styles.repoInfo}>
          <span className={styles.repoName}>
            {image.github_repo || image.image_name}
          </span>
          {image.releaseUrl && (
            <a
              href={image.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.releaseLink}
            >
              View Release →
            </a>
          )}
        </div>

        <div className={styles.versionInfo}>
          <div>Current: {image.current_version || 'Not set'}</div>
          {image.latest_version && image.has_update && (
            <div className={styles.latestVersion}>
              Latest: {image.latest_version}
            </div>
          )}
          {publishDate ? (
            <div>Released: {new Date(publishDate).toLocaleDateString()}</div>
          ) : image.source_type === 'github' &&
            (image.current_version || image.latest_version) ? (
            <div className={styles.unavailable}>Released: Not available</div>
          ) : null}
        </div>
      </div>

      <div className={styles.actions}>
        <button
          onClick={() => onEdit(image)}
          className={styles.actionButton}
          title="Edit"
        >
          <Pencil size={16} />
        </button>

        {image.source_type === 'github' && image.github_repo && (
          <button
            onClick={handleGitHubClick}
            className={styles.actionButton}
            title="Open GitHub repository"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            GitHub
          </button>
        )}

        {(!image.source_type || image.source_type === 'docker') &&
          image.image_name && (
            <button
              onClick={handleDockerHubClick}
              className={styles.actionButton}
              title="Open Docker Hub repository"
            >
              <img
                src="/img/docker-mark-white.svg"
                alt="Docker"
                className={styles.dockerIcon}
              />
              Docker Hub
            </button>
          )}

        {image.latest_version &&
          (image.has_update ||
            !image.current_version ||
            image.current_version !== image.latest_version) && (
            <button
              onClick={() => onUpgrade(image.id, image.latest_version)}
              className={`${styles.actionButton} ${styles.upgradeButton}`}
            >
              Updated
            </button>
          )}
      </div>
    </div>
  );
}

TrackedAppCard.propTypes = {
  image: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    name: PropTypes.string.isRequired,
    github_repo: PropTypes.string,
    image_name: PropTypes.string,
    current_version: PropTypes.string,
    latest_version: PropTypes.string,
    has_update: PropTypes.bool,
    source_type: PropTypes.oneOf(['github', 'docker']),
    releaseUrl: PropTypes.string,
    latestVersionPublishDate: PropTypes.string,
    currentVersionPublishDate: PropTypes.string,
  }).isRequired,
  onEdit: PropTypes.func.isRequired,
  onUpgrade: PropTypes.func.isRequired,
};

export default TrackedAppCard;


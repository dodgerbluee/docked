/**
 * TrackedAppCard Component
 * Reusable card component for displaying a tracked app (Docker image or GitHub repo)
 */

import React, { useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { Pencil, ArrowUp } from 'lucide-react';
import { getDockerHubRepoUrl } from '../utils/formatters';
import GitHubIcon from './icons/GitHubIcon';
import Button from './ui/Button';
import styles from './TrackedAppCard.module.css';

/**
 * TrackedAppCard component
 * @param {Object} image - Tracked image data
 * @param {Function} onEdit - Handler for edit action
 * @param {Function} onUpgrade - Handler for upgrade action
 */
const TrackedAppCard = React.memo(function TrackedAppCard({ image, onEdit, onUpgrade }) {
  // Memoize computed values
  const hasNoLatestVersion = useMemo(
    () =>
      !image.latest_version ||
      image.latest_version === 'Unknown' ||
      image.latest_version.trim() === '',
    [image.latest_version]
  );

  const borderStyle = useMemo(
    () =>
      hasNoLatestVersion
        ? '2px solid var(--text-secondary)'
        : '1px solid var(--border-color)',
    [hasNoLatestVersion]
  );

  const publishDate = useMemo(() => {
    if (image.source_type === 'github') {
      if (
        image.latest_version &&
        image.has_update &&
        image.latestVersionPublishDate
      ) {
        return image.latestVersionPublishDate;
      } else if (image.currentVersionPublishDate) {
        return image.currentVersionPublishDate;
      }
    } else {
      return image.currentVersionPublishDate;
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
  const handleGitHubClick = useCallback(() => {
    const repoUrl = image.github_repo.startsWith('http')
      ? image.github_repo
      : `https://github.com/${image.github_repo}`;
    window.open(repoUrl, '_blank', 'noopener,noreferrer');
  }, [image.github_repo]);

  const handleDockerHubClick = useCallback(() => {
    const dockerHubUrl = getDockerHubRepoUrl(image.image_name);
    if (dockerHubUrl) {
      window.open(dockerHubUrl, '_blank', 'noopener,noreferrer');
    }
  }, [image.image_name]);

  const handleEdit = useCallback(() => {
    onEdit(image);
  }, [image, onEdit]);

  const handleUpgrade = useCallback(() => {
    onUpgrade(image.id, image.latest_version);
  }, [image.id, image.latest_version, onUpgrade]);

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
        <Button
          onClick={handleEdit}
          variant="outline"
          size="sm"
          title="Edit"
          aria-label="Edit"
        >
          <Pencil size={21} />
        </Button>

        {image.source_type === 'github' && image.github_repo && (
          <Button
            onClick={handleGitHubClick}
            variant="outline"
            size="sm"
            title="Open GitHub repository"
            aria-label="Open GitHub repository"
          >
            <GitHubIcon size={16} />
            <span style={{ marginLeft: '4px' }}>GitHub</span>
          </Button>
        )}

        {(!image.source_type || image.source_type === 'docker') &&
          image.image_name && (
            <Button
              onClick={handleDockerHubClick}
              variant="outline"
              size="sm"
              title="Open Docker Hub repository"
              aria-label="Open Docker Hub repository"
            >
              <img
                src="/img/docker-mark-white.svg"
                alt="Docker"
                className={styles.dockerIcon}
              />
              <span style={{ marginLeft: '4px' }}>Docker Hub</span>
            </Button>
          )}

        {image.latest_version &&
          (image.has_update ||
            !image.current_version ||
            image.current_version !== image.latest_version) && (
            <Button
              onClick={handleUpgrade}
              variant="outline"
              size="sm"
              icon={ArrowUp}
              iconPosition="left"
              title="Update to latest version"
              aria-label="Update to latest version"
            >
              Updated
            </Button>
          )}
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
    source_type: PropTypes.oneOf(['github', 'docker']),
    releaseUrl: PropTypes.string,
    latestVersionPublishDate: PropTypes.string,
    currentVersionPublishDate: PropTypes.string,
  }).isRequired,
  onEdit: PropTypes.func.isRequired,
  onUpgrade: PropTypes.func.isRequired,
};

export default TrackedAppCard;


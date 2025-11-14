/**
 * TrackedAppCard Component
 * Reusable card component for displaying a tracked app (Docker image or GitHub repo)
 */

import React, { useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { Pencil, Check } from 'lucide-react';
import { getDockerHubRepoUrl } from '../utils/formatters';
import GitHubIcon from './icons/GitHubIcon';
import Button from './ui/Button';
import styles from './TrackedAppCard.module.css';

/**
 * TrackedAppCard component
 * @param {Object} image - Tracked image data
 * @param {Function} onEdit - Handler for edit action
 * @param {Function} onUpgrade - Handler for upgrade action
 * @param {boolean} selected - Whether the card is selected
 * @param {Function} onToggleSelect - Handler for toggling selection
 */
const TrackedAppCard = React.memo(function TrackedAppCard({ image, onEdit, onUpgrade, selected = false, onToggleSelect }) {
  // Memoize computed values
  const hasNoLatestVersion = useMemo(
    () =>
      !image.latest_version ||
      image.latest_version === 'Unknown' ||
      image.latest_version.trim() === '',
    [image.latest_version]
  );

  // Truncate display name to 18 characters
  const truncateDisplayName = (name) => {
    if (!name) return name;
    if (name.length <= 18) return name;
    return name.substring(0, 18) + "...";
  };

  const truncatedDisplayName = truncateDisplayName(image.name);

  // Truncate version to 25 characters (no ellipsis)
  const truncateVersion = (version) => {
    if (!version) return version;
    if (version.length <= 30) return version;
    return version.substring(0, 30);
  };

  const truncatedLatestVersion = image.latest_version && image.has_update 
    ? truncateVersion(image.latest_version) 
    : null;
  const truncatedCurrentVersion = truncateVersion(image.current_version || 'Not set');

  // Construct GitHub release URL for a version
  const getVersionReleaseUrl = (version) => {
    if (!version || version === 'Not set' || !image.github_repo) return null;
    // Use releaseUrl if available (for latest version), otherwise construct it
    if (version === image.latest_version && image.releaseUrl) {
      return image.releaseUrl;
    }
    // Construct URL: https://github.com/{owner}/{repo}/releases/tag/{version}
    const repoUrl = image.github_repo.startsWith('http')
      ? image.github_repo
      : `https://github.com/${image.github_repo}`;
    return `${repoUrl}/releases/tag/${version}`;
  };


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
      } ${image.has_update ? styles.updateAvailable : styles.noUpdate}`}
    >
      <div className={styles.content}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span 
              className={styles.name}
              title={image.name}
            >
              {truncatedDisplayName}
            </span>
          </div>
        </div>

        <div className={styles.repoInfo}>
          {image.source_type === 'github' && image.github_repo ? (
            <a
              href={image.github_repo.startsWith('http') ? image.github_repo : `https://github.com/${image.github_repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.repoName}
              onClick={(e) => e.stopPropagation()}
            >
              {image.github_repo}
            </a>
          ) : (
            <span className={styles.repoName}>
              {image.github_repo || image.image_name}
            </span>
          )}
          <div className={styles.iconGroup}>
            {image.source_type === 'github' && image.github_repo && (
              <>
                <a
                  href={image.github_repo.startsWith('http') ? image.github_repo : `https://github.com/${image.github_repo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.githubIconLink}
                  title="Open GitHub repository"
                  aria-label="Open GitHub repository"
                  onClick={(e) => e.stopPropagation()}
                >
                  <GitHubIcon size={14} />
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
              </>
            )}
            {(!image.source_type || image.source_type === 'docker') && image.image_name && (
              <>
                <a
                  href={getDockerHubRepoUrl(image.image_name) || '#'}
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
                  <img
                    src="/img/docker-mark-white.svg"
                    alt="Docker"
                    className={styles.dockerIconSmall}
                  />
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
              </>
            )}
          </div>
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
          {truncatedLatestVersion && (
            <p className={styles.metaItem}>
              <strong>Latest:</strong>{' '}
              {image.source_type === 'github' && getVersionReleaseUrl(image.latest_version) ? (
                <a
                  href={getVersionReleaseUrl(image.latest_version)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.versionLink}
                  title={image.latest_version}
                  onClick={(e) => e.stopPropagation()}
                >
                  {truncatedLatestVersion}
                </a>
              ) : (
                <span title={image.latest_version}>{truncatedLatestVersion}</span>
              )}
            </p>
          )}
          <p className={styles.metaItem}>
            <strong>Current:</strong>{' '}
            {image.source_type === 'github' && getVersionReleaseUrl(image.current_version) ? (
              <a
                href={getVersionReleaseUrl(image.current_version)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.versionLink}
                title={image.current_version || 'Not set'}
                onClick={(e) => e.stopPropagation()}
              >
                {truncatedCurrentVersion}
              </a>
            ) : (
              <span title={image.current_version || 'Not set'}>{truncatedCurrentVersion}</span>
            )}
          </p>
          {publishDate ? (
            <p className={styles.metaItem}>
              <strong>Released:</strong> {new Date(publishDate).toLocaleDateString()}
            </p>
          ) : image.source_type === 'github' &&
            (image.current_version || image.latest_version) ? (
            <p className={styles.metaItem}>
              <strong>Released:</strong> <span className={styles.unavailable}>Not available</span>
            </p>
          ) : null}
        </div>
      </div>

      <div className={styles.actions}>
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
  selected: PropTypes.bool,
  onToggleSelect: PropTypes.func,
};

export default TrackedAppCard;


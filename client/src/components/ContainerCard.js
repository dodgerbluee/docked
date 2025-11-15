/**
 * Container Card Component
 * Displays information about a single container
 */

import React, { memo } from 'react';
import { getDockerHubUrl, formatTimeAgo } from '../utils/formatters';

const ContainerCard = memo(
  ({
    container,
    isPortainer,
    selected,
    upgrading,
    onToggleSelect,
    onUpgrade,
  }) => {
    return (
      <div
        className={`container-card ${container.hasUpdate ? 'update-available' : ''} ${
          isPortainer ? 'portainer-disabled' : ''
        }`}
        title={
          isPortainer
            ? 'Portainer cannot be upgraded automatically. It must be upgraded manually.'
            : ''
        }
      >
        <div className="card-header">
          <h3>{container.name}</h3>
          {container.hasUpdate && (
            <label className="container-checkbox">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(container.id)}
                disabled={upgrading || isPortainer}
                title={
                  isPortainer
                    ? 'Portainer cannot be upgraded automatically. It must be upgraded manually.'
                    : ''
                }
              />
            </label>
          )}
        </div>
        <div className="card-body">
          {container.portainerName && (
            <p className="portainer-info">
              <strong>Portainer:</strong>{' '}
              <span className="portainer-badge">{container.portainerName}</span>
            </p>
          )}
          <p className="image-info">
            <strong>Image:</strong> {container.image}
          </p>
          <p className="status-info">
            <strong>Status:</strong> {container.status}
          </p>
          {container.hasUpdate && (
            <>
              <p className="tag-info">
                <strong>Current:</strong>{' '}
                <span className="version-badge current">
                  {container.currentDigest ? (
                    `sha256:${container.currentDigest}`
                  ) : (
                    container.currentVersion ||
                    container.currentTag ||
                    'latest'
                  )}
                </span>
              </p>
              <p className="tag-info">
                <strong>Latest:</strong>{' '}
                <span className="version-badge new">
                  {container.latestDigest ? (
                    <a
                      href={getDockerHubUrl(
                        container.image,
                        container.latestTag || container.newVersion
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="digest-link"
                      title="View layer on Docker Hub"
                    >
                      sha256:{container.latestDigest}
                    </a>
                  ) : (
                    container.newVersion ||
                    container.latestTag ||
                    'latest'
                  )}
                </span>
              </p>
              {container.latestPublishDate && (
                <p className="publish-info" style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                  <strong>Published:</strong> {formatTimeAgo(container.latestPublishDate)}
                </p>
              )}
            </>
          )}
          {!container.hasUpdate && container.currentDigest && (
            <p className="tag-info">
              <strong>Digest:</strong>{' '}
              <span className="version-badge current">
                sha256:{container.currentDigest}
              </span>
            </p>
          )}
        </div>
        {container.hasUpdate && (
          <div className="card-footer">
            <button
              className="upgrade-button"
              onClick={() => onUpgrade(container)}
              disabled={upgrading || isPortainer}
              title={
                isPortainer
                  ? 'Portainer cannot be upgraded automatically. It must be upgraded manually.'
                  : ''
              }
            >
              {upgrading ? 'Upgrading...' : 'Upgrade Now'}
            </button>
          </div>
        )}
      </div>
    );
  }
);

ContainerCard.displayName = 'ContainerCard';

export default ContainerCard;


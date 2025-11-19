/**
 * Container version display component
 */

import React from "react";
import PropTypes from "prop-types";
import { getDockerHubUrl, getDockerHubTagsUrl, formatTimeAgo } from "../../../../utils/formatters";
import styles from "../../PortainerContainerCard.module.css";

/**
 * Container version display component
 * @param {Object} props
 * @param {Object} props.container - Container object
 * @param {string} props.imageVersion - Image version/tag
 * @param {Function} props.onVersionClick - Version click handler
 * @param {boolean} props.showUpdates - Whether to show updates
 */
const ContainerVersionDisplay = ({ container, imageVersion, onVersionClick, showUpdates }) => {
  if (!showUpdates) {
    return (
      <>
        <p className={styles.metaItem}>
          <strong>Version:</strong>{" "}
          <span className={styles.versionText} title={imageVersion} onClick={onVersionClick}>
            {imageVersion}
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
                ? `sha256:${container.currentDigest}`
                : container.currentTag || container.currentVersion || "latest"}
            </a>
          </span>
        </p>
        {container.currentVersionPublishDate && (
          <p className={styles.metaItem}>
            <strong>Published:</strong> {formatTimeAgo(container.currentVersionPublishDate)}
          </p>
        )}
      </>
    );
  }

  return (
    <p className={styles.metaItem}>
      <strong>Version:</strong>{" "}
      <span className={styles.versionText} title={imageVersion} onClick={onVersionClick}>
        {imageVersion}
      </span>
    </p>
  );
};

ContainerVersionDisplay.propTypes = {
  container: PropTypes.object.isRequired,
  imageVersion: PropTypes.string.isRequired,
  onVersionClick: PropTypes.func.isRequired,
  showUpdates: PropTypes.bool.isRequired,
};

export default ContainerVersionDisplay;

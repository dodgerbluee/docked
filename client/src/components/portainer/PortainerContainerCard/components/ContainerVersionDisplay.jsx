/**
 * Container version display component
 */

import React from "react";
import PropTypes from "prop-types";
import { formatTimeAgo } from "../../../../utils/formatters";
import styles from "../../PortainerContainerCard.module.css";

/**
 * Container version display component
 * @param {Object} props
 * @param {Object} props.container - Container object
 * @param {string} props.imageVersion - Image version/tag
 * @param {Function} props.onVersionClick - Version click handler
 * @param {boolean} props.showUpdates - Whether to show updates
 * @param {React.ReactNode} [props.badge] - Optional badge element to render right-aligned on the version row
 */
const ContainerVersionDisplay = ({
  container,
  imageVersion,
  onVersionClick,
  showUpdates,
  badge,
}) => {
  if (!showUpdates) {
    return (
      <>
        <div className={styles.versionRow}>
          <p className={styles.metaItem}>
            <strong>Version:</strong>{" "}
            <span className={styles.versionText} title={imageVersion} onClick={onVersionClick}>
              {imageVersion}
            </span>
          </p>
          {badge}
        </div>
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
        {container.currentVersionPublishDate && (
          <p className={styles.metaItem}>
            <strong>Published:</strong> {formatTimeAgo(container.currentVersionPublishDate)}
          </p>
        )}
      </>
    );
  }

  return (
    <div className={styles.versionRow}>
      <p className={styles.metaItem}>
        <strong>Version:</strong>{" "}
        <span className={styles.versionText} title={imageVersion} onClick={onVersionClick}>
          {imageVersion}
        </span>
      </p>
      {badge}
    </div>
  );
};

ContainerVersionDisplay.propTypes = {
  container: PropTypes.object.isRequired,
  imageVersion: PropTypes.string.isRequired,
  onVersionClick: PropTypes.func.isRequired,
  showUpdates: PropTypes.bool.isRequired,
  badge: PropTypes.node,
};

export default ContainerVersionDisplay;

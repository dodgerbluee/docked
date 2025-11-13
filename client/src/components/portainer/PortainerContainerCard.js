import React from "react";
import PropTypes from "prop-types";
import {
  getDockerHubUrl,
  getDockerHubTagsUrl,
  getDockerHubRepoUrl,
  formatTimeAgo,
} from "../../utils/formatters";
import { PORTAINER_CONTAINER_MESSAGE } from "../../constants/portainerPage";
import Button from "../ui/Button";
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
          {showUpdates && container.hasUpdate && (
            <span className={styles.updateBadge} title="Update Available">
              !
            </span>
          )}
          {!showUpdates && (
            <span className={styles.currentBadge}>✓</span>
          )}
          <h3>{container.name}</h3>
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
        {showUpdates && container.portainerName && (
          <p className={styles.stackInfo}>
            <strong>Portainer:</strong>{" "}
            <span className={styles.stackLabel}>
              {container.portainerName}
            </span>
          </p>
        )}
        <p className={styles.imageInfo}>
          <strong>Image:</strong>{" "}
          <span className={styles.imageName} title={container.image}>
            {container.image}
          </span>
        </p>
        {showUpdates && container.latestPublishDate && (
          <p className={styles.publishInfo}>
            <strong>Published:</strong> {formatTimeAgo(container.latestPublishDate)}
          </p>
        )}
        {!showUpdates && container.currentDigest && (
          <>
            <p className={styles.tagInfo}>
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
                  sha256:{container.currentDigest}
                </a>
              </span>
            </p>
            {container.currentVersionPublishDate && (
              <p className={styles.publishInfo}>
                <strong>Published:</strong>{" "}
                {formatTimeAgo(container.currentVersionPublishDate)}
              </p>
            )}
          </>
        )}
        <div className={styles.buttonGroup}>
          {container.image && container.existsInDockerHub !== false && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                const dockerHubUrl = getDockerHubRepoUrl(container.image);
                if (dockerHubUrl) {
                  window.open(dockerHubUrl, "_blank", "noopener,noreferrer");
                }
              }}
              title="Open Docker Hub repository"
              aria-label="Open Docker Hub repository"
            >
              <img
                src="/img/docker-mark-white.svg"
                alt=""
                className={styles.dockerIcon}
                aria-hidden="true"
              />
              <span style={{ marginLeft: "4px" }}>Docker Hub</span>
            </Button>
          )}
          {showUpdates && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onUpgrade(container)}
              disabled={upgrading || isPortainer}
              title={isPortainer ? PORTAINER_CONTAINER_MESSAGE : "Upgrade container"}
              aria-label={`Upgrade ${container.name}`}
            >
              {upgrading ? "Updating..." : "Update"}
            </Button>
          )}
        </div>
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


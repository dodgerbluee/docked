import React, { useCallback } from "react";
import PropTypes from "prop-types";
import { HardDriveDownload, RefreshCw, AlertCircle } from "lucide-react";
import { formatTimeAgo } from "../../utils/formatters";
import { showToast } from "../../utils/toast";
import { PORTAINER_CONTAINER_MESSAGE } from "../../constants/portainerPage";
import { useContainerImageInfo } from "./PortainerContainerCard/hooks/useContainerImageInfo";
import ContainerImageLinks from "./PortainerContainerCard/components/ContainerImageLinks";
import ContainerVersionDisplay from "./PortainerContainerCard/components/ContainerVersionDisplay";
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
  developerModeEnabled = false,
  onOpenDebugModal,
}) {
  // Use extracted hook for image info
  const {
    imageVersion,
    imageNameWithoutVersion,
    isGitHub: isGitHubContainer,
    isGitLab: isGitLabContainer,
    isGoogle: isGoogleContainer,
    isDocker: isDockerHub,
    githubUrl,
    gitlabUrl,
    googleUrl,
    dockerHubUrl,
    handleVersionClick,
    handleImageNameClick,
  } = useContainerImageInfo(container);

  // Handle container name click - open debug modal in developer mode, otherwise copy to clipboard
  const handleContainerNameClick = useCallback(
    async (e) => {
      e.stopPropagation();

      // If developer mode is enabled, open debug modal
      if (developerModeEnabled && container.id && onOpenDebugModal) {
        onOpenDebugModal({ id: container.id, name: container.name });
        return;
      }

      // Otherwise, copy to clipboard
      if (container.name) {
        try {
          await navigator.clipboard.writeText(container.name);
          showToast("Container name copied", "info");
        } catch (err) {
          console.error("Failed to copy container name to clipboard:", err);
          showToast("Failed to copy container name", "error");
        }
      }
    },
    [container.name, container.id, developerModeEnabled, onOpenDebugModal]
  );

  // Handle card click to open upgrade/rebuild modal
  const handleCardClick = useCallback(
    (e) => {
      // Don't trigger if clicking on interactive elements
      // Check if the click target is an interactive element or its child
      const target = e.target;
      const isInteractiveElement =
        target.tagName === "A" ||
        target.tagName === "BUTTON" ||
        target.tagName === "INPUT" ||
        target.closest("a") ||
        target.closest("button") ||
        target.closest("label") ||
        target.closest('[role="button"]') ||
        // Check for specific interactive elements by class or data attributes
        (target.closest &&
          (target.closest(`.${styles.checkbox}`) ||
            target.closest(`.${styles.upgradeCheckmark}`) ||
            target.closest(`.${styles.rebuildButton}`) ||
            target.closest(`.${styles.containerName}`) ||
            target.closest(`.${styles.imageHeader}`) ||
            target.closest(`.${styles.versionText}`) ||
            target.closest(`.${styles.portainerBadge}`)));

      // For "Up to Date" cards (showUpdates === false), only allow clicking if developer mode is enabled
      // For "Updates" cards (showUpdates === true), allow clicking as normal
      const canClickUpToDateCard = showUpdates || developerModeEnabled;

      if (
        !isPortainer &&
        !upgrading &&
        !isInteractiveElement &&
        onUpgrade &&
        canClickUpToDateCard
      ) {
        onUpgrade(container);
      }
    },
    [isPortainer, upgrading, onUpgrade, container, showUpdates, developerModeEnabled]
  );

  return (
    <div
      className={`${styles.containerCard} ${
        showUpdates ? styles.updateAvailable : styles.currentCard
      } ${isPortainer ? styles.portainerDisabled : ""} ${
        !isPortainer && !upgrading && (showUpdates || developerModeEnabled)
          ? styles.clickableCard
          : ""
      }`}
      title={isPortainer ? PORTAINER_CONTAINER_MESSAGE : undefined}
      role="article"
      aria-label={`Container ${container.name}`}
      onClick={handleCardClick}
    >
      <div
        className={styles.cardHeader}
        title={isPortainer ? PORTAINER_CONTAINER_MESSAGE : undefined}
      >
        <div className={styles.headerLeft}>
          <h3
            className={styles.containerName}
            title={developerModeEnabled ? "Click to view debug info" : container.name}
            onClick={handleContainerNameClick}
          >
            {container.name}
          </h3>
        </div>
        {showUpdates && (
          <label className={styles.checkbox} onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => {
                e.stopPropagation();
                onToggleSelect(container.id);
              }}
              disabled={upgrading || isPortainer}
              title={isPortainer ? PORTAINER_CONTAINER_MESSAGE : undefined}
              aria-label={`Select ${container.name} for upgrade`}
            />
          </label>
        )}
      </div>
      <div
        className={styles.cardBody}
        title={isPortainer ? PORTAINER_CONTAINER_MESSAGE : undefined}
      >
        <div className={styles.imageHeaderContainer}>
          <div className={styles.imageHeaderLeft}>
            <h4
              className={`${styles.imageHeader} ${showUpdates ? styles.imageHeaderWithUpdates : ""}`}
              title={imageNameWithoutVersion}
              onClick={handleImageNameClick}
            >
              {imageNameWithoutVersion}
            </h4>
          </div>
          <div className={styles.iconGroup}>
            {container.image &&
              (isDockerHub || isGitHubContainer || isGitLabContainer || isGoogleContainer) && (
                <ContainerImageLinks
                  isDocker={isDockerHub}
                  isGitHub={isGitHubContainer}
                  isGitLab={isGitLabContainer}
                  isGoogle={isGoogleContainer}
                  dockerHubUrl={dockerHubUrl}
                  githubUrl={githubUrl}
                  gitlabUrl={gitlabUrl}
                  googleUrl={googleUrl}
                  imageName={container.image}
                />
              )}
            {!showUpdates && !isPortainer && developerModeEnabled && (
              <span
                className={`${styles.rebuildButton} ${upgrading ? styles.upgrading : ""} ${isPortainer || upgrading ? styles.disabled : ""}`}
                title={
                  isPortainer
                    ? PORTAINER_CONTAINER_MESSAGE
                    : upgrading
                      ? "Rebuilding..."
                      : "Rebuild container with latest image"
                }
                aria-label={
                  isPortainer
                    ? PORTAINER_CONTAINER_MESSAGE
                    : upgrading
                      ? "Rebuilding..."
                      : "Rebuild container with latest image"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isPortainer && !upgrading && onUpgrade) {
                    onUpgrade(container);
                  }
                }}
              >
                {upgrading ? (
                  <span className={styles.upgradingText}>Rebuilding...</span>
                ) : (
                  <RefreshCw size={18} />
                )}
              </span>
            )}
            {showUpdates && (
              <span
                className={`${styles.upgradeCheckmark} ${isPortainer || upgrading ? styles.disabled : ""} ${upgrading ? styles.upgrading : ""}`}
                title={
                  isPortainer ? PORTAINER_CONTAINER_MESSAGE : upgrading ? "Upgrading..." : "Upgrade"
                }
                aria-label={
                  isPortainer ? PORTAINER_CONTAINER_MESSAGE : upgrading ? "Upgrading..." : "Upgrade"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isPortainer && !upgrading) {
                    onUpgrade(container);
                  }
                }}
              >
                {upgrading ? (
                  <span className={styles.upgradingText}>Upgrading...</span>
                ) : (
                  <HardDriveDownload size={18} />
                )}
              </span>
            )}
          </div>
        </div>
        {showUpdates &&
          container.portainerName &&
          (container.portainerUrl ? (
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
            <span
              className={styles.portainerBadge}
              title={`Portainer instance: ${container.portainerName}`}
            >
              {container.portainerName}
            </span>
          ))}
        {showUpdates && container.latestPublishDate && (
          <p className={styles.metaItem}>
            <strong>Published:</strong> {formatTimeAgo(container.latestPublishDate)}
          </p>
        )}
        {container.noDigest && (
          <div
            className={styles.noDigestBadge}
            title="Container was checked but no digest was returned from the registry"
          >
            <AlertCircle size={14} />
            <span>No Digest</span>
          </div>
        )}
        {!showUpdates && container.currentDigest && (
          <>
            {container.portainerName &&
              (container.portainerUrl ? (
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
                <span
                  className={styles.portainerBadge}
                  title={`Portainer instance: ${container.portainerName}`}
                >
                  {container.portainerName}
                </span>
              ))}
            {container.noDigest && (
              <div
                className={styles.noDigestBadge}
                title="Container was checked but no digest was returned from the registry"
              >
                <AlertCircle size={14} />
                <span>No Digest</span>
              </div>
            )}
            <ContainerVersionDisplay
              container={container}
              imageVersion={imageVersion}
              onVersionClick={handleVersionClick}
              showUpdates={showUpdates}
            />
          </>
        )}
        {showUpdates && (
          <ContainerVersionDisplay
            container={container}
            imageVersion={imageVersion}
            onVersionClick={handleVersionClick}
            showUpdates={showUpdates}
          />
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
  developerModeEnabled: PropTypes.bool,
  onOpenDebugModal: PropTypes.func,
};

PortainerContainerCard.displayName = "PortainerContainerCard";

export default PortainerContainerCard;

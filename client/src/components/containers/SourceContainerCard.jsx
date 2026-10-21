import React, { useCallback } from "react";
import PropTypes from "prop-types";
import { AlertCircle } from "lucide-react";
import { formatTimeAgo } from "../../utils/formatters";
import { PORTAINER_CONTAINER_MESSAGE } from "../../constants/containersPage";
import { useContainerImageInfo } from "./ContainerCardDetails/hooks/useContainerImageInfo";
import ContainerVersionDisplay from "./ContainerCardDetails/components/ContainerVersionDisplay";
import styles from "./SourceContainerCard.module.css";

/**
 * SourceContainerCard Component
 * Displays a container card with source-page specific styling
 */
const SourceContainerCard = React.memo(function SourceContainerCard({
  container,
  isPortainer,
  selected,
  upgrading,
  showUpdates,
  onToggleSelect,
  onUpgrade,
  developerModeEnabled = false,
  disabledMessage,
}) {
  // Resolve the tooltip message: use explicit prop, fall back to Portainer default
  const blockedMessage = disabledMessage || PORTAINER_CONTAINER_MESSAGE;
  // Use extracted hook for image info
  const { imageVersion, imageNameWithoutVersion, handleVersionClick, handleImageClick } =
    useContainerImageInfo(container);

  // Whether this card can open the upgrade/rebuild confirm popup right now.
  // For "Up to Date" cards (showUpdates === false), only allow opening if
  // developer mode is enabled; for "Updates" cards, allow as normal.
  const canOpenUpgrade =
    !isPortainer && !upgrading && !!onUpgrade && (showUpdates || developerModeEnabled);

  // Handle container name click - open the upgrade confirm popup (current vs
  // available version), same as clicking the card body.
  const handleContainerNameClick = useCallback(
    (e) => {
      e.stopPropagation();
      if (canOpenUpgrade) {
        onUpgrade(container);
      }
    },
    [canOpenUpgrade, onUpgrade, container]
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
            target.closest(`.${styles.imageHeader}`) ||
            target.closest(`.${styles.versionText}`) ||
            target.closest(`.${styles.portainerBadge}`)));

      if (canOpenUpgrade && !isInteractiveElement) {
        onUpgrade(container);
      }
    },
    [canOpenUpgrade, onUpgrade, container]
  );

  // Render instance badge — runner name tag
  const instanceName = container.sourceName || container.runnerName;
  const instanceBadge = instanceName ? (
    <span className={styles.portainerBadge} title={`Runner: ${instanceName}`}>
      {instanceName}
    </span>
  ) : null;

  return (
    <div
      className={`${styles.containerCard} ${
        showUpdates ? styles.updateAvailable : styles.currentCard
      } ${isPortainer ? styles.portainerDisabled : ""} ${
        !isPortainer && !upgrading && (showUpdates || developerModeEnabled)
          ? styles.clickableCard
          : ""
      }`}
      title={isPortainer ? blockedMessage : undefined}
      role="article"
      aria-label={`Container ${container.name}`}
      onClick={handleCardClick}
    >
      <div className={styles.cardHeader} title={isPortainer ? blockedMessage : undefined}>
        <div className={styles.headerLeft}>
          <h3
            className={styles.containerName}
            title={container.name}
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
              title={isPortainer ? blockedMessage : undefined}
              aria-label={`Select ${container.name} for upgrade`}
            />
          </label>
        )}
      </div>
      <div className={styles.cardBody} title={isPortainer ? blockedMessage : undefined}>
        <div className={styles.imageHeaderContainer}>
          <div className={styles.imageHeaderLeft}>
            <h4
              className={`${styles.imageHeader} ${showUpdates ? styles.imageHeaderWithUpdates : ""}`}
              title={imageNameWithoutVersion}
              onClick={handleImageClick}
            >
              {imageNameWithoutVersion}
            </h4>
          </div>
          {!showUpdates && !isPortainer && developerModeEnabled && (
            <div className={styles.iconGroup}>
              <span
                className={`${styles.rebuildButton} ${upgrading ? styles.upgrading : ""} ${isPortainer || upgrading ? styles.disabled : ""}`}
                title={
                  isPortainer
                    ? blockedMessage
                    : upgrading
                      ? "Rebuilding..."
                      : "Rebuild container with latest image"
                }
                aria-label={
                  isPortainer
                    ? blockedMessage
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
                  <span className={styles.rebuildText}>Rebuild</span>
                )}
              </span>
            </div>
          )}
        </div>
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
            <ContainerVersionDisplay
              container={container}
              imageVersion={imageVersion}
              onVersionClick={handleVersionClick}
              showUpdates={showUpdates}
              badge={instanceBadge}
            />
          </>
        )}
        {showUpdates && (
          <ContainerVersionDisplay
            container={container}
            imageVersion={imageVersion}
            onVersionClick={handleVersionClick}
            showUpdates={showUpdates}
            badge={instanceBadge}
          />
        )}
      </div>
    </div>
  );
});

SourceContainerCard.propTypes = {
  container: PropTypes.object.isRequired,
  isPortainer: PropTypes.bool.isRequired,
  selected: PropTypes.bool.isRequired,
  upgrading: PropTypes.bool.isRequired,
  showUpdates: PropTypes.bool.isRequired,
  onToggleSelect: PropTypes.func.isRequired,
  onUpgrade: PropTypes.func.isRequired,
  developerModeEnabled: PropTypes.bool,
  disabledMessage: PropTypes.string,
};

SourceContainerCard.displayName = "SourceContainerCard";

export default SourceContainerCard;

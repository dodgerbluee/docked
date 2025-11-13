import React, { useCallback, memo } from "react";
import PropTypes from "prop-types";
import { ExternalLink } from "lucide-react";
import { STAT_TYPES } from "../constants/summaryPage";
import StatItem from "./StatItem";
import styles from "./PortainerInstanceCard.module.css";

/**
 * Card component for displaying Portainer instance statistics
 * @param {Object} props - Component props
 * @param {Object} props.instance - Portainer instance stat object
 * @param {string} props.instance.name - Instance name
 * @param {string} props.instance.url - Instance URL
 * @param {number} props.instance.total - Total containers
 * @param {number} props.instance.withUpdates - Containers with updates
 * @param {number} props.instance.upToDate - Containers up to date
 * @param {number} props.instance.unusedImages - Unused images count
 * @param {Function} props.onInstanceClick - Handler for clicking the instance header
 * @param {Function} props.onStatClick - Handler for clicking individual stats
 */
const PortainerInstanceCard = ({
  instance,
  onInstanceClick,
  onStatClick,
}) => {
  const handleInstanceClick = useCallback(() => {
    if (onInstanceClick) {
      onInstanceClick(instance.name);
    }
  }, [onInstanceClick, instance.name]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleInstanceClick();
      }
    },
    [handleInstanceClick]
  );

  // Configuration for stat items
  const statItems = [
    {
      type: STAT_TYPES.UPDATES,
      value: instance.withUpdates,
      label: "Updates",
      variant: instance.withUpdates > 0 ? "statNumberUpdate" : "",
    },
    {
      type: STAT_TYPES.CURRENT,
      value: instance.upToDate,
      label: "Current",
      variant: "statNumberCurrent",
    },
    {
      type: STAT_TYPES.UNUSED,
      value: instance.unusedImages,
      label: "Unused",
      variant: "statNumberUnused",
    },
  ];

  return (
    <div className={styles.instanceCard}>
      <div
        className={styles.instanceHeader}
        onClick={handleInstanceClick}
        role="button"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label={`View ${instance.name} details`}
      >
        <h4>{instance.name}</h4>
        {instance.url && (
          <a
            href={instance.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={styles.externalLink}
            title={`Open ${instance.name} in Portainer`}
            aria-label={`Open ${instance.name} in Portainer`}
          >
            <ExternalLink size={18} />
          </a>
        )}
      </div>
      <div className={styles.instanceStats}>
        {statItems.map((item) => (
          <StatItem
            key={item.type}
            value={item.value}
            label={item.label}
            variant={item.variant}
            onClick={() => {
              if (onStatClick) {
                onStatClick(instance.name, item.type);
              }
            }}
          />
        ))}
      </div>
    </div>
  );
};

PortainerInstanceCard.propTypes = {
  instance: PropTypes.shape({
    name: PropTypes.string.isRequired,
    url: PropTypes.string,
    total: PropTypes.number.isRequired,
    withUpdates: PropTypes.number.isRequired,
    upToDate: PropTypes.number.isRequired,
    unusedImages: PropTypes.number.isRequired,
  }).isRequired,
  onInstanceClick: PropTypes.func,
  onStatClick: PropTypes.func,
};

// Memoize component to prevent unnecessary re-renders
export default memo(PortainerInstanceCard);


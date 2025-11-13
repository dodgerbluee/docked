import React from "react";
import PropTypes from "prop-types";
import { ExternalLink } from "lucide-react";
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
 * @param {Function} props.getContentTab - Function to get the content tab based on stat type
 */
const PortainerInstanceCard = ({
  instance,
  onInstanceClick,
  onStatClick,
  getContentTab,
}) => {
  const handleStatClick = (statType) => {
    if (onStatClick) {
      onStatClick(instance.name, getContentTab(statType));
    }
  };

  const handleInstanceClick = () => {
    if (onInstanceClick) {
      onInstanceClick(instance.name);
    }
  };

  return (
    <div className={styles.instanceCard}>
      <div
        className={styles.instanceHeader}
        onClick={handleInstanceClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleInstanceClick();
          }
        }}
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
          >
            <ExternalLink size={18} />
          </a>
        )}
      </div>
      <div className={styles.instanceStats}>
        <div
          className={styles.instanceStat}
          onClick={() => handleStatClick("updates")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleStatClick("updates");
            }
          }}
        >
          <span className={styles.statNumber}>{instance.total}</span>
          <span className={styles.statText}>Total</span>
        </div>
        <div
          className={styles.instanceStat}
          onClick={(e) => {
            e.stopPropagation();
            handleStatClick("updates");
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleStatClick("updates");
            }
          }}
        >
          <span className={`${styles.statNumber} ${styles.statNumberUpdate}`}>
            {instance.withUpdates}
          </span>
          <span className={styles.statText}>Updates</span>
        </div>
        <div
          className={styles.instanceStat}
          onClick={(e) => {
            e.stopPropagation();
            handleStatClick("current");
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleStatClick("current");
            }
          }}
        >
          <span className={`${styles.statNumber} ${styles.statNumberCurrent}`}>
            {instance.upToDate}
          </span>
          <span className={styles.statText}>Current</span>
        </div>
        <div
          className={styles.instanceStat}
          onClick={(e) => {
            e.stopPropagation();
            handleStatClick("unused");
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleStatClick("unused");
            }
          }}
        >
          <span className={styles.statNumber}>{instance.unusedImages}</span>
          <span className={styles.statText}>Unused</span>
        </div>
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
  getContentTab: PropTypes.func,
};

export default PortainerInstanceCard;


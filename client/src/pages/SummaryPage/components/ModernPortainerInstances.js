import React from "react";
import PropTypes from "prop-types";
import { Server, ExternalLink } from "lucide-react";
import styles from "./ModernPortainerInstances.module.css";

/**
 * Modern Portainer Instances component with integrated dashboard design
 */
const ModernPortainerInstances = ({
  portainerStats,
  shouldShowEmptyState,
  onInstanceClick,
  onStatClick,
}) => {
  return (
    <div className={styles.instancesContainer}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <Server size={20} className={styles.headerIcon} />
          <h3 className={styles.title}>Portainer Instances</h3>
        </div>
      </div>

      <div className={styles.content}>
        {shouldShowEmptyState || portainerStats.length === 0 ? (
          <div className={styles.emptyState}>
            <Server size={32} className={styles.emptyIcon} />
            <p className={styles.emptyText}>No Portainer instances configured</p>
          </div>
        ) : (
          <div className={styles.instancesGrid}>
            {portainerStats.map((instance) => (
              <div
                key={instance.name}
                className={styles.instanceCard}
                onClick={() => onInstanceClick && onInstanceClick(instance.name)}
              >
                <div className={styles.cardHeader}>
                  <h4 className={styles.instanceName}>{instance.name}</h4>
                  {instance.url && (
                    <a
                      href={instance.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className={styles.externalLink}
                      title="Open in Portainer"
                    >
                      <ExternalLink size={18} />
                    </a>
                  )}
                </div>

                <div className={styles.instanceStats}>
                  <div
                    className={`${styles.statItem} ${styles.updates}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onStatClick && onStatClick(instance.name, "updates");
                    }}
                  >
                    <div className={styles.statContent}>
                      <div
                        className={`${styles.statValue} ${instance.withUpdates > 0 ? styles.hasUpdates : ""}`}
                      >
                        {instance.withUpdates}
                      </div>
                      <div className={styles.statLabel}>Updates</div>
                    </div>
                  </div>

                  <div
                    className={`${styles.statItem} ${styles.current}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onStatClick && onStatClick(instance.name, "current");
                    }}
                  >
                    <div className={styles.statContent}>
                      <div className={styles.statValue}>{instance.upToDate}</div>
                      <div className={styles.statLabel}>Current</div>
                    </div>
                  </div>

                  <div
                    className={`${styles.statItem} ${styles.unused}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onStatClick && onStatClick(instance.name, "unused");
                    }}
                  >
                    <div className={styles.statContent}>
                      <div className={styles.statValue}>{instance.unusedImages}</div>
                      <div className={styles.statLabel}>Unused</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

ModernPortainerInstances.propTypes = {
  portainerStats: PropTypes.array,
  shouldShowEmptyState: PropTypes.bool,
  onInstanceClick: PropTypes.func,
  onStatClick: PropTypes.func,
};

ModernPortainerInstances.defaultProps = {
  portainerStats: [],
  shouldShowEmptyState: false,
};

export default ModernPortainerInstances;

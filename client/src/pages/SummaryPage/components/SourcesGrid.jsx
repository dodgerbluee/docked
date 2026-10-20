import React from "react";
import PropTypes from "prop-types";
import { Server } from "lucide-react";
import styles from "./SourcesGrid.module.css";

/**
 * Modern Sources component with integrated dashboard design
 */
const SourcesGrid = ({ sourceStats, shouldShowEmptyState, onInstanceClick, onStatClick }) => {
  return (
    <div className={styles.instancesContainer}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <Server size={20} className={styles.headerIcon} />
          <h3 className={styles.title}>Sources</h3>
        </div>
      </div>

      <div className={styles.content}>
        {shouldShowEmptyState || sourceStats.length === 0 ? (
          <div className={styles.emptyState}>
            <Server size={32} className={styles.emptyIcon} />
            <p className={styles.emptyText}>No sources configured</p>
          </div>
        ) : (
          <div className={styles.instancesGrid}>
            {sourceStats.map((instance) => (
              <div
                key={instance.name}
                className={styles.instanceCard}
                onClick={() => onInstanceClick && onInstanceClick(instance.name)}
              >
                <div className={styles.cardHeader}>
                  <h4 className={styles.instanceName}>{instance.name}</h4>
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

SourcesGrid.propTypes = {
  sourceStats: PropTypes.array,
  shouldShowEmptyState: PropTypes.bool,
  onInstanceClick: PropTypes.func,
  onStatClick: PropTypes.func,
};

SourcesGrid.defaultProps = {
  sourceStats: [],
  shouldShowEmptyState: false,
};

export default SourcesGrid;

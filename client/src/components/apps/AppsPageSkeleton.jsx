import React from "react";
import styles from "./AppsPageSkeleton.module.css";

/**
 * Skeleton placeholder for AppsPage while initial data is loading.
 * Matches the real layout: a grid of app cards with shimmer animation.
 */
const AppsPageSkeleton = React.memo(function AppsPageSkeleton() {
  return (
    <div className={styles.skeletonContainer}>
      <div className={styles.grid}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className={styles.card}>
            {/* Header: name + runner badge */}
            <div className={styles.cardHeader}>
              <div className={`${styles.skeleton} ${styles.cardName}`} />
              <div className={`${styles.skeleton} ${styles.runnerBadge}`} />
            </div>
            {/* Description */}
            <div className={`${styles.skeleton} ${styles.descriptionLine}`} />
            <div
              className={`${styles.skeleton} ${styles.descriptionLine} ${styles.descriptionShort}`}
            />
            {/* Version row */}
            <div className={styles.versionRow}>
              <div className={`${styles.skeleton} ${styles.versionBadge}`} />
            </div>
            {/* Operations row */}
            <div className={styles.operationsRow}>
              <div className={`${styles.skeleton} ${styles.opButton}`} />
              <div className={`${styles.skeleton} ${styles.opButton} ${styles.opButtonWide}`} />
            </div>
            {/* Footer */}
            <div className={styles.cardFooter}>
              <div className={`${styles.skeleton} ${styles.footerLine}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

export default AppsPageSkeleton;

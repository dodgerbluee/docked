import React from "react";
import styles from "./TrackedAppsPageSkeleton.module.css";

/**
 * Skeleton placeholder for TrackedAppsPage while initial data is loading.
 * Matches the real layout: a grid of tracked-app cards with shimmer animation.
 */
const TrackedAppsPageSkeleton = React.memo(function TrackedAppsPageSkeleton() {
  return (
    <div className={styles.skeletonContainer}>
      {/* Section header skeleton */}
      <div className={styles.sectionHeader}>
        <div className={styles.sectionHeaderLeft}>
          <div className={`${styles.skeleton} ${styles.toggleIcon}`} />
          <div className={`${styles.skeleton} ${styles.sectionTitle}`} />
        </div>
        <div className={`${styles.skeleton} ${styles.sectionCount}`} />
      </div>

      {/* Card grid */}
      <div className={styles.grid}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className={styles.card}>
            {/* Name */}
            <div className={`${styles.skeleton} ${styles.cardName}`} />
            {/* Repo info with separator */}
            <div className={styles.cardRepoInfo}>
              <div className={`${styles.skeleton} ${styles.cardRepo}`} />
            </div>
            {/* Version meta lines */}
            <div className={styles.cardMeta}>
              <div className={`${styles.skeleton} ${styles.metaLine}`} />
              <div className={`${styles.skeleton} ${styles.metaLine} ${styles.metaLineShort}`} />
              <div className={`${styles.skeleton} ${styles.metaLine} ${styles.metaLineMedium}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

export default TrackedAppsPageSkeleton;

import React from "react";
import styles from "./AnalyticsPageSkeleton.module.css";

/**
 * Skeleton placeholder for AnalyticsPage while initial data is loading.
 * Matches the real layout: stats bar at top, chart grid below.
 */
const AnalyticsPageSkeleton = React.memo(function AnalyticsPageSkeleton() {
  return (
    <div className={styles.skeletonContainer}>
      {/* Stats bar */}
      <div className={styles.statsBar}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={styles.statCard}>
            <div className={`${styles.skeleton} ${styles.statIcon}`} />
            <div className={styles.statLines}>
              <div className={`${styles.skeleton} ${styles.statValue}`} />
              <div className={`${styles.skeleton} ${styles.statLabel}`} />
            </div>
          </div>
        ))}
      </div>

      {/* Charts grid */}
      <div className={styles.chartsGrid}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={styles.chartCard}>
            <div className={`${styles.skeleton} ${styles.chartTitle}`} />
            <div className={styles.chartArea}>
              {/* Fake axis lines */}
              <div className={styles.chartAxisY} />
              <div className={styles.chartAxisX} />
              {/* Fake bars / area shape */}
              <div className={styles.chartBars}>
                {[35, 55, 70, 45, 80, 60, 50, 75, 40, 65].map((h, idx) => (
                  <div
                    key={idx}
                    className={`${styles.skeleton} ${styles.chartBar}`}
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

export default AnalyticsPageSkeleton;

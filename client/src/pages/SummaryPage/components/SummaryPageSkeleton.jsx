import React from "react";
import styles from "./SummaryPageSkeleton.module.css";

/**
 * Skeleton placeholder for SummaryPage while initial data is loading.
 * Matches the real layout: 5 hero stat cards, left column (instances + health/images),
 * and right column (activity feed).
 */
const SummaryPageSkeleton = React.memo(function SummaryPageSkeleton() {
  return (
    <div className={styles.modernDashboard}>
      {/* Hero stat cards */}
      <div className={styles.heroRow}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={styles.heroCard}>
            <div className={`${styles.skeleton} ${styles.heroCardIcon}`} />
            <div className={styles.heroCardLines}>
              <div className={`${styles.skeleton} ${styles.heroCardValue}`} />
              <div className={`${styles.skeleton} ${styles.heroCardLabel}`} />
            </div>
          </div>
        ))}
      </div>

      {/* Dashboard grid */}
      <div className={styles.dashboardGrid}>
        {/* Left column */}
        <div className={styles.leftColumn}>
          {/* Instances section */}
          <div className={styles.instancesSection}>
            <div className={`${styles.skeleton} ${styles.sectionTitle}`} />
            <div className={styles.instancesGrid}>
              {[1, 2, 3].map((i) => (
                <div key={i} className={styles.instanceCard}>
                  <div className={styles.instanceCardHeader}>
                    <div className={`${styles.skeleton} ${styles.instanceCardLogo}`} />
                    <div className={styles.heroCardLines}>
                      <div className={`${styles.skeleton} ${styles.instanceCardTitle}`} />
                      <div className={`${styles.skeleton} ${styles.instanceCardUrl}`} />
                    </div>
                  </div>
                  <div className={styles.instanceCardStats}>
                    <div className={`${styles.skeleton} ${styles.instanceCardStat}`} />
                    <div className={`${styles.skeleton} ${styles.instanceCardStat}`} />
                    <div className={`${styles.skeleton} ${styles.instanceCardStat}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Health & images row */}
          <div className={styles.healthImagesRow}>
            <div className={styles.healthCard}>
              <div className={`${styles.skeleton} ${styles.sectionTitle}`} />
              <div className={`${styles.skeleton} ${styles.ringPlaceholder}`} />
              <div className={`${styles.skeleton} ${styles.barPlaceholder}`} />
              <div className={`${styles.skeleton} ${styles.barPlaceholder} ${styles.barShort}`} />
            </div>
            <div className={styles.imagesCard}>
              <div className={`${styles.skeleton} ${styles.sectionTitle}`} />
              <div className={`${styles.skeleton} ${styles.ringPlaceholder}`} />
              <div className={`${styles.skeleton} ${styles.barPlaceholder}`} />
              <div className={`${styles.skeleton} ${styles.barPlaceholder} ${styles.barShort}`} />
            </div>
          </div>
        </div>

        {/* Right column — activity feed */}
        <div className={styles.rightColumn}>
          <div className={styles.activitySection}>
            <div className={`${styles.skeleton} ${styles.sectionTitle}`} />
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className={styles.activityItem}>
                <div className={`${styles.skeleton} ${styles.activityDot}`} />
                <div className={styles.activityLines}>
                  <div
                    className={`${styles.skeleton} ${styles.activityLine} ${styles.activityLineLong}`}
                  />
                  <div
                    className={`${styles.skeleton} ${styles.activityLine} ${styles.activityLineShort}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

export default SummaryPageSkeleton;

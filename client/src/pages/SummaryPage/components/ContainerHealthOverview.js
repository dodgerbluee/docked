import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Activity, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import { CONTENT_TABS } from "../../../constants/summaryPage";
import styles from "./ContainerHealthOverview.module.css";

/**
 * Container health overview with visual chart
 */
const ContainerHealthOverview = ({ containers, summaryStats, shouldShowEmptyState, onStatClick }) => {
  const healthData = useMemo(() => {
    const total = shouldShowEmptyState ? 0 : summaryStats.totalContainers;
    const withUpdates = shouldShowEmptyState ? 0 : summaryStats.containersWithUpdates;
    const upToDate = shouldShowEmptyState ? 0 : summaryStats.containersUpToDate;

    const updatesPercentage = total > 0 ? Math.round((withUpdates / total) * 100) : 0;
    const upToDatePercentage = total > 0 ? Math.round((upToDate / total) * 100) : 0;

    return {
      total,
      withUpdates,
      upToDate,
      updatesPercentage,
      upToDatePercentage,
    };
  }, [summaryStats, shouldShowEmptyState, containers]);

  const healthScore = useMemo(() => {
    if (healthData.total === 0) return 0;
    return healthData.upToDatePercentage;
  }, [healthData]);

  const getHealthStatus = (score) => {
    if (score >= 90) return { label: "Excellent", color: "green" };
    if (score >= 70) return { label: "Good", color: "blue" };
    if (score >= 50) return { label: "Fair", color: "orange" };
    return { label: "Needs Attention", color: "red" };
  };

  const status = getHealthStatus(healthScore);

  return (
    <div className={styles.healthOverview}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <Activity size={20} className={styles.headerIcon} />
          <h3 className={styles.title}>Container Health</h3>
        </div>
      </div>

      <div className={styles.content}>
        {/* Health Score Ring */}
        <div className={styles.healthScoreSection}>
          <div className={styles.scoreRing}>
            <svg viewBox="0 0 200 200" className={styles.ringChart}>
              <circle
                cx="100"
                cy="100"
                r="85"
                fill="none"
                stroke="var(--border-color)"
                strokeWidth="20"
              />
              <circle
                cx="100"
                cy="100"
                r="85"
                fill="none"
                stroke={`var(--color-${status.color})`}
                strokeWidth="20"
                strokeDasharray={`${(healthScore / 100) * 534} 534`}
                strokeLinecap="round"
                transform="rotate(-90 100 100)"
                className={styles.progressCircle}
              />
            </svg>
            <div className={styles.scoreContent}>
              <div className={styles.scoreValue}>{healthScore}%</div>
              <div className={`${styles.scoreLabel} ${styles[`status-${status.color}`]}`}>
                {status.label}
              </div>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className={styles.statsGrid}>
          <div
            className={`${styles.statItem} ${styles.clickable}`}
            onClick={() => !shouldShowEmptyState && onStatClick && onStatClick(CONTENT_TABS.ALL)}
          >
            <div className={styles.statIcon}>
              <Activity size={18} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>{healthData.total}</div>
              <div className={styles.statLabel}>Total</div>
            </div>
          </div>

          <div
            className={`${styles.statItem} ${styles.clickable} ${healthData.withUpdates > 0 ? styles.warning : ""}`}
            onClick={() => !shouldShowEmptyState && onStatClick && onStatClick(CONTENT_TABS.UPDATES)}
          >
            <div className={styles.statIcon}>
              <TrendingUp size={18} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>{healthData.withUpdates}</div>
              <div className={styles.statLabel}>Updates</div>
              <div className={styles.statPercentage}>{healthData.updatesPercentage}%</div>
            </div>
          </div>

          <div
            className={`${styles.statItem} ${styles.clickable} ${styles.success}`}
            onClick={() => !shouldShowEmptyState && onStatClick && onStatClick(CONTENT_TABS.CURRENT)}
          >
            <div className={styles.statIcon}>
              <CheckCircle2 size={18} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>{healthData.upToDate}</div>
              <div className={styles.statLabel}>Up to Date</div>
              <div className={styles.statPercentage}>{healthData.upToDatePercentage}%</div>
            </div>
          </div>
        </div>

        {/* Health Bar */}
        <div className={styles.healthBar}>
          <div className={styles.healthBarTrack}>
            {healthData.upToDate > 0 && (
              <div
                className={`${styles.healthBarSegment} ${styles.upToDate}`}
                style={{ width: `${healthData.upToDatePercentage}%` }}
                title={`${healthData.upToDate} up to date`}
              />
            )}
            {healthData.withUpdates > 0 && (
              <div
                className={`${styles.healthBarSegment} ${styles.needsUpdate}`}
                style={{ width: `${healthData.updatesPercentage}%` }}
                title={`${healthData.withUpdates} need updates`}
              />
            )}
          </div>
          <div className={styles.healthBarLegend}>
            <div className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.upToDate}`} />
              <span className={styles.legendLabel}>Up to Date</span>
            </div>
            <div className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.needsUpdate}`} />
              <span className={styles.legendLabel}>Has Update</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

ContainerHealthOverview.propTypes = {
  containers: PropTypes.array,
  summaryStats: PropTypes.object.isRequired,
  shouldShowEmptyState: PropTypes.bool,
  onStatClick: PropTypes.func,
};

ContainerHealthOverview.defaultProps = {
  containers: [],
  shouldShowEmptyState: false,
};

export default ContainerHealthOverview;

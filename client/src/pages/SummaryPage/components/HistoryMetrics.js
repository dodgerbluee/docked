import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { TrendingUp, CheckCircle, XCircle, Clock, History, Zap } from "lucide-react";
import { useUpgradeHistory } from "../../../hooks/useUpgradeHistory";
import styles from "./HistoryMetrics.module.css";

/**
 * Format duration from milliseconds to human-readable string
 */
function formatDuration(ms) {
  if (!ms) return "N/A";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * History metrics component showing upgrade history and statistics
 */
const HistoryMetrics = () => {
  const { stats, statsLoading, history } = useUpgradeHistory({ limit: 200 });
  // Calculate success rate
  const successRate = useMemo(() => {
    if (!stats || stats.total_upgrades === 0) return 0;
    return Math.round((stats.successful_upgrades / stats.total_upgrades) * 100);
  }, [stats]);

  // Get most frequently upgraded containers
  const topUpgradedContainers = useMemo(() => {
    if (!history || history.length === 0) return [];
    
    const containerCounts = {};
    history.forEach((upgrade) => {
      const name = upgrade.container_name;
      containerCounts[name] = (containerCounts[name] || 0) + 1;
    });

    return Object.entries(containerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
  }, [history]);

  // Get success rate status
  const getSuccessStatus = (rate) => {
    if (rate >= 95) return { label: "Excellent", color: "green" };
    if (rate >= 85) return { label: "Good", color: "blue" };
    if (rate >= 70) return { label: "Fair", color: "orange" };
    return { label: "Needs Improvement", color: "red" };
  };

  const successStatus = getSuccessStatus(successRate);

  if (statsLoading) {
    return (
      <div className={styles.historyMetrics}>
        <div className={styles.header}>
          <div className={styles.headerContent}>
            <History size={20} className={styles.headerIcon} />
            <h3 className={styles.title}>Upgrade History & Stats</h3>
          </div>
        </div>
        <div className={styles.content}>
          <div className={styles.loading}>Loading history...</div>
        </div>
      </div>
    );
  }

  if (!stats || stats.total_upgrades === 0) {
    return null; // Don't show if no upgrades yet
  }

  return (
    <div className={styles.historyMetrics}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <History size={18} className={styles.headerIcon} />
          <h3 className={styles.title}>Upgrade History</h3>
        </div>
      </div>

      <div className={styles.content}>
        {/* Compact stats display */}
        <div className={styles.compactStats}>
          <div className={styles.compactStatItem}>
            <div className={styles.compactValue}>{stats.total_upgrades}</div>
            <div className={styles.compactLabel}>Total Upgrades</div>
          </div>
          <div className={`${styles.compactStatItem} ${styles.success}`}>
            <div className={styles.compactValue}>{successRate}%</div>
            <div className={styles.compactLabel}>Success Rate</div>
          </div>
          <div className={styles.compactStatItem}>
            <div className={styles.compactValue}>
              {stats.avg_duration_ms ? formatDuration(stats.avg_duration_ms) : "N/A"}
            </div>
            <div className={styles.compactLabel}>Avg Duration</div>
          </div>
          {topUpgradedContainers.length > 0 && (
            <div className={styles.compactStatItem}>
              <div className={styles.compactValue}>
                {topUpgradedContainers[0].name}
              </div>
              <div className={styles.compactLabel}>
                Most Upgraded ({topUpgradedContainers[0].count}×)
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

HistoryMetrics.propTypes = {};

HistoryMetrics.defaultProps = {};

export default HistoryMetrics;

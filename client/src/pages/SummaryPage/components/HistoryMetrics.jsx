import React, { useMemo, useState } from "react";
import { History } from "lucide-react";
import { useUpgradeHistory } from "../../../hooks/useUpgradeHistory";
import { useTrackedAppUpgradeHistory } from "../../../hooks/useTrackedAppUpgradeHistory";
import UpgradeChartsModal from "../../../components/portainer/UpgradeChartsModal";
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
 * History metrics component showing upgrade analytics and statistics
 */
const HistoryMetrics = () => {
  const { stats, statsLoading, history } = useUpgradeHistory({ limit: 200 });
  const { history: trackedAppHistory = [] } = useTrackedAppUpgradeHistory();
  const [isChartsModalOpen, setIsChartsModalOpen] = useState(false);
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

  // eslint-disable-next-line no-unused-vars
  const successStatus = getSuccessStatus(successRate);

  // Calculate sparkline data (last 7 days)
  const sparklineData = useMemo(() => {
    if (!history || history.length === 0) return [];

    const now = new Date();
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      last7Days.push({
        date,
        count: 0,
        success: 0,
      });
    }

    history.forEach((upgrade) => {
      const upgradeDate = new Date(upgrade.created_at);
      upgradeDate.setHours(0, 0, 0, 0);

      const dayIndex = last7Days.findIndex((day) => day.date.getTime() === upgradeDate.getTime());
      if (dayIndex !== -1) {
        last7Days[dayIndex].count++;
        if (upgrade.status === "success") {
          last7Days[dayIndex].success++;
        }
      }
    });

    return last7Days;
  }, [history]);

  // Calculate top insight
  const topInsight = useMemo(() => {
    if (!stats || stats.total_upgrades === 0) return null;

    // Success rate insight
    if (successRate >= 95) {
      return { icon: "🎯", text: `${successRate}% success rate - Excellent!` };
    }
    if (successRate >= 85) {
      return { icon: "✅", text: `${successRate}% success rate` };
    }

    // Speed insight
    if (stats.avg_duration_ms && stats.avg_duration_ms < 30000) {
      return { icon: "⚡", text: `Lightning fast ${formatDuration(stats.avg_duration_ms)} avg` };
    }

    // Volume insight
    if (stats.total_upgrades >= 100) {
      return { icon: "🚀", text: `${stats.total_upgrades} total upgrades!` };
    }

    // Default
    return { icon: "📊", text: `${stats.total_upgrades} upgrades tracked` };
  }, [stats, successRate]);

  // Calculate mini stats for visual display
  const miniStats = useMemo(() => {
    if (!stats || stats.total_upgrades === 0) return null;

    return {
      total: stats.total_upgrades,
      successRate,
      avgDuration: stats.avg_duration_ms ? formatDuration(stats.avg_duration_ms) : "N/A",
      mostUpgraded: topUpgradedContainers.length > 0 ? topUpgradedContainers[0].name : "N/A",
    };
  }, [stats, successRate, topUpgradedContainers]);

  // Calculate most upgraded containers (top 3 for chart)
  const mostUpgradedChart = useMemo(() => {
    if (!topUpgradedContainers || topUpgradedContainers.length === 0) return [];
    return topUpgradedContainers.slice(0, 3);
  }, [topUpgradedContainers]);

  // Process tracked app data - top upgraded apps
  const topUpgradedTrackedApps = useMemo(() => {
    if (!trackedAppHistory || trackedAppHistory.length === 0) return [];

    const appCounts = {};
    trackedAppHistory.forEach((upgrade) => {
      const name = upgrade.app_name || upgrade.repository || "Unknown";
      appCounts[name] = (appCounts[name] || 0) + 1;
    });

    return Object.entries(appCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));
  }, [trackedAppHistory]);

  // Calculate tracked app sparkline data (last 7 days)
  const trackedAppSparklineData = useMemo(() => {
    if (!trackedAppHistory || trackedAppHistory.length === 0) return [];

    const now = new Date();
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      last7Days.push({
        date,
        count: 0,
        success: 0,
      });
    }

    trackedAppHistory.forEach((upgrade) => {
      const upgradeDate = new Date(upgrade.created_at);
      upgradeDate.setHours(0, 0, 0, 0);

      const dayIndex = last7Days.findIndex((day) => day.date.getTime() === upgradeDate.getTime());
      if (dayIndex !== -1) {
        last7Days[dayIndex].count++;
        if (upgrade.status === "success") {
          last7Days[dayIndex].success++;
        }
      }
    });

    return last7Days;
  }, [trackedAppHistory]);

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
    <>
      <div className={styles.historyMetrics}>
        <div className={styles.header}>
          <div className={styles.headerContent}>
            <History size={18} className={styles.headerIcon} />
            <h3 className={styles.title}>Analytics</h3>
          </div>
        </div>

        <div className={styles.content}>
          {/* Mini Stats Grid */}
          {miniStats && (
            <div className={styles.miniStatsGrid}>
              <div className={styles.miniStatCard}>
                <div className={styles.miniStatValue}>{miniStats.total}</div>
                <div className={styles.miniStatLabel}>Total Upgrades</div>
              </div>
              <div className={styles.miniStatCard}>
                <div className={styles.miniStatValue} style={{ color: "#10b981" }}>
                  {miniStats.successRate}%
                </div>
                <div className={styles.miniStatLabel}>Success Rate</div>
              </div>
              <div className={styles.miniStatCard}>
                <div className={styles.miniStatValue}>{miniStats.avgDuration}</div>
                <div className={styles.miniStatLabel}>Avg Duration</div>
              </div>
            </div>
          )}

          {/* Mini Charts */}
          <div className={styles.miniChartsGrid}>
            {/* Most Upgraded Containers */}
            <div className={styles.miniChartCard}>
              <h4 className={styles.miniChartTitle}>Most Upgraded Images</h4>
              <div className={styles.horizontalBarChart}>
                {mostUpgradedChart.map((container, index) => {
                  const maxCount = mostUpgradedChart[0]?.count || 1;
                  const width = (container.count / maxCount) * 100;

                  return (
                    <div key={index} className={styles.horizontalBarItem}>
                      <div className={styles.horizontalBarLabel} title={container.name}>
                        {container.name}
                      </div>
                      <div className={styles.horizontalBarTrack}>
                        <div className={styles.horizontalBarFill} style={{ width: `${width}%` }} />
                        <span className={styles.horizontalBarCount}>{container.count}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Image Upgrade Frequency */}
            <div className={styles.miniChartCard}>
              <h4 className={styles.miniChartTitle}>Image Upgrade Frequency (7 Days)</h4>
              <div className={styles.barChart}>
                {sparklineData.map((day, index) => {
                  const maxCount = Math.max(...sparklineData.map((d) => d.count), 1);
                  const height = day.count > 0 ? (day.count / maxCount) * 100 : 5;

                  return (
                    <div key={index} className={styles.barChartBar}>
                      <div
                        className={styles.barChartFill}
                        style={{
                          height: `${height}%`,
                        }}
                        title={`${day.count} upgrade${day.count !== 1 ? "s" : ""}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Most Upgraded Tracked Apps */}
            <div className={styles.miniChartCard}>
              <h4 className={styles.miniChartTitle}>Most Upgraded Apps</h4>
              <div className={styles.horizontalBarChart}>
                {topUpgradedTrackedApps.length > 0 ? (
                  topUpgradedTrackedApps.map((app, index) => {
                    const maxCount = Math.max(...topUpgradedTrackedApps.map((a) => a.count), 1);
                    const width = (app.count / maxCount) * 100;

                    return (
                      <div key={index} className={styles.horizontalBarItem}>
                        <div className={styles.horizontalBarLabel} title={app.name}>
                          {app.name}
                        </div>
                        <div className={styles.horizontalBarTrack}>
                          <div
                            className={`${styles.horizontalBarFill} ${styles.trackedApp}`}
                            style={{ width: `${width}%` }}
                          />
                          <span className={styles.horizontalBarCount}>{app.count}</span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className={styles.emptyChartMessage}>No app upgrades yet</div>
                )}
              </div>
            </div>

            {/* Tracked App Frequency */}
            <div className={styles.miniChartCard}>
              <h4 className={styles.miniChartTitle}>App Frequency (7 Days)</h4>
              <div className={styles.barChart}>
                {trackedAppSparklineData.length > 0 ? (
                  trackedAppSparklineData.map((day, index) => {
                    const maxCount = Math.max(...trackedAppSparklineData.map((d) => d.count), 1);
                    const height = day.count > 0 ? (day.count / maxCount) * 100 : 5;

                    return (
                      <div key={index} className={styles.barChartBar}>
                        <div
                          className={`${styles.barChartFill} ${styles.trackedApp}`}
                          style={{
                            height: `${height}%`,
                          }}
                          title={`${day.count} upgrade${day.count !== 1 ? "s" : ""}`}
                        />
                      </div>
                    );
                  })
                ) : (
                  <div className={styles.emptyChartMessage}>No data for the last 7 days</div>
                )}
              </div>
            </div>
          </div>

          {/* Analytics CTA Button */}
          {topInsight && (
            <button className={styles.analyticsButton} onClick={() => setIsChartsModalOpen(true)}>
              <div className={styles.buttonContent}>
                <span className={styles.buttonIcon}>{topInsight.icon}</span>
                <div className={styles.buttonText}>
                  <span className={styles.buttonTitle}>View Analytics</span>
                  {/* <span className={styles.buttonSubtitle}>{topInsight.text}</span> */}
                </div>
              </div>
              <div className={styles.buttonArrow}>→</div>
            </button>
          )}
        </div>
      </div>

      {/* Charts Modal */}
      <UpgradeChartsModal
        isOpen={isChartsModalOpen}
        onClose={() => setIsChartsModalOpen(false)}
        history={history}
      />
    </>
  );
};

HistoryMetrics.propTypes = {};

HistoryMetrics.defaultProps = {};

export default HistoryMetrics;

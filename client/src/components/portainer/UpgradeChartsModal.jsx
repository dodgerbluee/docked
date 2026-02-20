/**
 * UpgradeChartsModal Component
 * Displays comprehensive analytics and charts for upgrade history
 */

import React, { useState, useMemo } from "react";
import PropTypes from "prop-types";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  X,
  TrendingUp,
  BarChart3,
  Clock,
  Target,
  Zap,
  Calendar,
  Award,
  Package,
} from "lucide-react";
import { useTrackedAppUpgradeHistory } from "../../hooks/useTrackedAppUpgradeHistory";
import styles from "./UpgradeChartsModal.module.css";

const COLORS = {
  primary: "#1e90ff",
  success: "#10b981",
  error: "#ef4444",
  warning: "#f59e0b",
  purple: "#8b5cf6",
  pink: "#ec4899",
  cyan: "#06b6d4",
  indigo: "#6366f1",
};

const CHART_COLORS = [
  COLORS.primary,
  COLORS.success,
  COLORS.purple,
  COLORS.pink,
  COLORS.cyan,
  COLORS.indigo,
  COLORS.warning,
];

/**
 * Custom tooltip for charts
 */
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipLabel}>{label}</p>
      {payload.map((entry, index) => (
        <p key={index} style={{ color: entry.color }} className={styles.tooltipValue}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
};

/**
 * Process history data for various charts
 */
function processChartData(history) {
  if (!history || history.length === 0) {
    return {
      upgradesOverTime: [],
      containerUpgradeCounts: [],
      successRateOverTime: [],
      avgDurationOverTime: [],
      topContainers: [],
      successRateByContainer: [],
      upgradesByDayOfWeek: [],
      upgradesByHour: [],
      durationDistribution: [],
      upgradesByInstance: [],
    };
  }

  // 1. Upgrades over time (daily)
  const upgradesByDate = {};
  history.forEach((upgrade) => {
    const date = new Date(upgrade.created_at).toLocaleDateString();
    if (!upgradesByDate[date]) {
      upgradesByDate[date] = { date, total: 0, success: 0, failed: 0 };
    }
    upgradesByDate[date].total++;
    if (upgrade.status === "success") {
      upgradesByDate[date].success++;
    } else {
      upgradesByDate[date].failed++;
    }
  });
  const upgradesOverTime = Object.values(upgradesByDate).sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  // 2. Container/App upgrade counts
  const containerCounts = {};
  history.forEach((upgrade) => {
    // Support both container_name and app_name fields
    const name = upgrade.container_name || upgrade.app_name || "Unknown";
    containerCounts[name] = (containerCounts[name] || 0) + 1;
  });
  const containerUpgradeCounts = Object.entries(containerCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // 3. Success rate over time (weekly rolling average)
  const successRateOverTime = upgradesOverTime.map((day) => ({
    date: day.date,
    rate: day.total > 0 ? Math.round((day.success / day.total) * 100) : 0,
  }));

  // 4. Average duration over time
  const durationsByDate = {};
  history.forEach((upgrade) => {
    if (upgrade.upgrade_duration_ms) {
      const date = new Date(upgrade.created_at).toLocaleDateString();
      if (!durationsByDate[date]) {
        durationsByDate[date] = { date, durations: [] };
      }
      durationsByDate[date].durations.push(upgrade.upgrade_duration_ms);
    }
  });
  const avgDurationOverTime = Object.entries(durationsByDate)
    .map(([date, data]) => ({
      date,
      avgDuration: Math.round(
        data.durations.reduce((a, b) => a + b, 0) / data.durations.length / 1000
      ),
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // 5. Top 10 most upgraded containers
  const topContainers = containerUpgradeCounts.slice(0, 10);

  // 6. Success rate by container/app (top 10)
  const containerStats = {};
  history.forEach((upgrade) => {
    // Support both container_name and app_name fields
    const name = upgrade.container_name || upgrade.app_name || "Unknown";
    if (!containerStats[name]) {
      containerStats[name] = { total: 0, success: 0 };
    }
    containerStats[name].total++;
    if (upgrade.status === "success") {
      containerStats[name].success++;
    }
  });
  const successRateByContainer = Object.entries(containerStats)
    .map(([name, stats]) => ({
      name,
      rate: Math.round((stats.success / stats.total) * 100),
      total: stats.total,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // 7. Upgrades by day of week
  const dayOfWeekCounts = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  history.forEach((upgrade) => {
    const day = days[new Date(upgrade.created_at).getDay()];
    dayOfWeekCounts[day]++;
  });
  const upgradesByDayOfWeek = days.map((day) => ({
    day,
    count: dayOfWeekCounts[day],
  }));

  // 8. Upgrades by hour of day
  const hourCounts = Array(24).fill(0);
  history.forEach((upgrade) => {
    const hour = new Date(upgrade.created_at).getHours();
    hourCounts[hour]++;
  });
  const upgradesByHour = hourCounts.map((count, hour) => ({
    hour: `${hour.toString().padStart(2, "0")}:00`,
    count,
  }));

  // 9. Duration distribution (bucketed)
  const durationBuckets = {
    "< 10s": 0,
    "10-30s": 0,
    "30s-1m": 0,
    "1-2m": 0,
    "2-5m": 0,
    "> 5m": 0,
  };
  history.forEach((upgrade) => {
    if (upgrade.upgrade_duration_ms) {
      const seconds = upgrade.upgrade_duration_ms / 1000;
      if (seconds < 10) durationBuckets["< 10s"]++;
      else if (seconds < 30) durationBuckets["10-30s"]++;
      else if (seconds < 60) durationBuckets["30s-1m"]++;
      else if (seconds < 120) durationBuckets["1-2m"]++;
      else if (seconds < 300) durationBuckets["2-5m"]++;
      else durationBuckets["> 5m"]++;
    }
  });
  const durationDistribution = Object.entries(durationBuckets).map(([range, count]) => ({
    range,
    count,
  }));

  // 10. Upgrades by Portainer instance
  const instanceCounts = {};
  history.forEach((upgrade) => {
    const instance = upgrade.portainer_instance_name || "Unknown";
    instanceCounts[instance] = (instanceCounts[instance] || 0) + 1;
  });
  const upgradesByInstance = Object.entries(instanceCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // 11. Weekly activity comparison (last 8 weeks)
  const weeklyActivity = {};
  history.forEach((upgrade) => {
    const date = new Date(upgrade.created_at);
    // Get week number
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const weekKey = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (!weeklyActivity[weekKey]) {
      weeklyActivity[weekKey] = { week: weekKey, upgrades: 0, success: 0, failed: 0 };
    }
    weeklyActivity[weekKey].upgrades++;
    if (upgrade.status === "success") {
      weeklyActivity[weekKey].success++;
    } else {
      weeklyActivity[weekKey].failed++;
    }
  });
  const weeklyComparison = Object.values(weeklyActivity)
    .sort((a, b) => {
      // Sort by date
      const dateA = new Date(a.week);
      const dateB = new Date(b.week);
      return dateA - dateB;
    })
    .slice(-8); // Last 8 weeks

  // 12. Activity heatmap data (day x hour)
  // Reuse the days array from above
  const heatmapData = [];
  const activityMatrix = {};

  history.forEach((upgrade) => {
    const date = new Date(upgrade.created_at);
    const day = days[date.getDay()];
    const hour = date.getHours();
    const key = `${day}-${hour}`;
    activityMatrix[key] = (activityMatrix[key] || 0) + 1;
  });

  // Find max for normalization
  const maxActivity = Math.max(...Object.values(activityMatrix), 1);

  days.forEach((day) => {
    for (let hour = 0; hour < 24; hour++) {
      const key = `${day}-${hour}`;
      const count = activityMatrix[key] || 0;
      heatmapData.push({
        day,
        hour: `${hour.toString().padStart(2, "0")}:00`,
        count,
        intensity: count / maxActivity,
      });
    }
  });

  return {
    upgradesOverTime,
    containerUpgradeCounts,
    successRateOverTime,
    avgDurationOverTime,
    topContainers,
    successRateByContainer,
    upgradesByDayOfWeek,
    upgradesByHour,
    durationDistribution,
    upgradesByInstance,
    weeklyComparison,
    heatmapData,
  };
}

/**
 * Calculate summary statistics
 */
function calculateStats(history) {
  if (!history || history.length === 0) {
    return {
      totalUpgrades: 0,
      successRate: 0,
      avgDuration: 0,
      uniqueContainers: 0,
      mostUpgradedContainer: "N/A",
      busiestDay: "N/A",
      busiestHour: "N/A",
      upgradeVelocity: "N/A",
      speedScore: "N/A",
      fastestUpgrade: "N/A",
      slowestUpgrade: "N/A",
      mostReliableContainer: "N/A",
    };
  }

  const successful = history.filter((u) => u.status === "success").length;
  const durations = history.filter((u) => u.upgrade_duration_ms).map((u) => u.upgrade_duration_ms);
  const avgDuration =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  const containerCounts = {};
  const containerSuccessRates = {};
  history.forEach((u) => {
    // Support both container_name and app_name fields
    const name = u.container_name || u.app_name || "Unknown";
    containerCounts[name] = (containerCounts[name] || 0) + 1;
    if (!containerSuccessRates[name]) {
      containerSuccessRates[name] = { total: 0, success: 0 };
    }
    containerSuccessRates[name].total++;
    if (u.status === "success") {
      containerSuccessRates[name].success++;
    }
  });
  const mostUpgradedContainer = Object.entries(containerCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  // Most reliable container (100% success rate with at least 3 upgrades)
  const reliableContainers = Object.entries(containerSuccessRates)
    .filter(([, stats]) => stats.total >= 3)
    .map(([name, stats]) => ({
      name,
      rate: (stats.success / stats.total) * 100,
      total: stats.total,
    }))
    .sort((a, b) => b.rate - a.rate || b.total - a.total);
  const mostReliableContainer = reliableContainers.length > 0 ? reliableContainers[0].name : "N/A";

  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayCounts = Array(7).fill(0);
  const hourCounts = Array(24).fill(0);
  history.forEach((u) => {
    const date = new Date(u.created_at);
    dayCounts[date.getDay()]++;
    hourCounts[date.getHours()]++;
  });
  const busiestDayIndex = dayCounts.indexOf(Math.max(...dayCounts));
  const busiestHourIndex = hourCounts.indexOf(Math.max(...hourCounts));

  // Calculate upgrade velocity (upgrades per day on average)
  const sortedHistory = [...history].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  );
  const firstUpgrade = new Date(sortedHistory[0]?.created_at);
  const lastUpgrade = new Date(sortedHistory[sortedHistory.length - 1]?.created_at);
  const daysDiff = Math.max(1, Math.ceil((lastUpgrade - firstUpgrade) / (1000 * 60 * 60 * 24)));
  const upgradeVelocity = (history.length / daysDiff).toFixed(1);

  // Speed Score: Based on average duration (lower is better)
  // < 30s = A+, < 60s = A, < 120s = B, < 300s = C, else = D
  let speedScore = "D";
  const avgDurationSeconds = avgDuration / 1000;
  if (avgDurationSeconds < 30) speedScore = "A+";
  else if (avgDurationSeconds < 60) speedScore = "A";
  else if (avgDurationSeconds < 120) speedScore = "B";
  else if (avgDurationSeconds < 300) speedScore = "C";

  // Fastest and slowest upgrades
  const sortedDurations = [...durations].sort((a, b) => a - b);
  const fastestUpgrade =
    sortedDurations.length > 0 ? `${(sortedDurations[0] / 1000).toFixed(1)}s` : "N/A";
  const slowestUpgrade =
    sortedDurations.length > 0
      ? `${(sortedDurations[sortedDurations.length - 1] / 1000).toFixed(1)}s`
      : "N/A";

  return {
    totalUpgrades: history.length,
    successRate: Math.round((successful / history.length) * 100),
    avgDuration: Math.round(avgDuration / 1000),
    uniqueContainers: Object.keys(containerCounts).length,
    mostUpgradedContainer,
    busiestDay: days[busiestDayIndex],
    busiestHour: `${busiestHourIndex.toString().padStart(2, "0")}:00`,
    upgradeVelocity: `${upgradeVelocity}/day`,
    speedScore,
    fastestUpgrade,
    slowestUpgrade,
    mostReliableContainer,
  };
}

function UpgradeChartsModal({ isOpen, onClose, history = [] }) {
  const [activeTab, setActiveTab] = useState("overview");

  // Fetch tracked app upgrade history
  const { history: trackedAppHistory = [] } = useTrackedAppUpgradeHistory();

  const chartData = useMemo(() => processChartData(history), [history]);
  const stats = useMemo(() => calculateStats(history), [history]);

  // Process tracked app data
  const trackedAppChartData = useMemo(
    () => processChartData(trackedAppHistory),
    [trackedAppHistory]
  );
  const trackedAppStats = useMemo(() => calculateStats(trackedAppHistory), [trackedAppHistory]);

  if (!isOpen) return null;

  // Show message if no data for either type
  const hasContainerData = history && history.length > 0;
  const hasTrackedAppData = trackedAppHistory && trackedAppHistory.length > 0;

  if (!hasContainerData && !hasTrackedAppData) {
    return (
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <button className={styles.closeButton} onClick={onClose}>
              <X size={20} />
            </button>
          </div>
          <div className={styles.content}>
            <div className={styles.emptyMessage}>
              <BarChart3 size={64} className={styles.emptyIcon} />
              <h3>No Data Available</h3>
              <p>Start upgrading containers and tracked apps to see analytics!</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: "overview", label: "Overview", icon: TrendingUp },
    { id: "containers", label: "Containers", icon: BarChart3 },
    { id: "tracked-apps", label: "Tracked Apps", icon: Package },
    { id: "performance", label: "Performance", icon: Zap },
    { id: "patterns", label: "Patterns", icon: Calendar },
    { id: "insights", label: "Insights", icon: Award },
  ];

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <button className={styles.closeButton} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Summary Stats Bar */}
        <div className={styles.statsBar}>
          <div className={styles.statItem}>
            <Target size={20} className={styles.statIcon} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {stats.totalUpgrades + trackedAppStats.totalUpgrades}
              </div>
              <div className={styles.statLabel}>Total Upgrades</div>
            </div>
          </div>
          <div className={styles.statItem}>
            <Award size={20} className={styles.statIconSuccess} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {hasContainerData && hasTrackedAppData
                  ? Math.round(
                      (stats.totalUpgrades * stats.successRate +
                        trackedAppStats.totalUpgrades * trackedAppStats.successRate) /
                        (stats.totalUpgrades + trackedAppStats.totalUpgrades)
                    )
                  : hasContainerData
                    ? stats.successRate
                    : trackedAppStats.successRate}
                %
              </div>
              <div className={styles.statLabel}>Success Rate</div>
            </div>
          </div>
          <div className={styles.statItem}>
            <Clock size={20} className={styles.statIcon} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {hasContainerData && hasTrackedAppData
                  ? Math.round(
                      (stats.totalUpgrades * stats.avgDuration +
                        trackedAppStats.totalUpgrades * trackedAppStats.avgDuration) /
                        (stats.totalUpgrades + trackedAppStats.totalUpgrades)
                    )
                  : hasContainerData
                    ? stats.avgDuration
                    : trackedAppStats.avgDuration}
                s
              </div>
              <div className={styles.statLabel}>Avg Duration</div>
            </div>
          </div>
          <div className={styles.statItem}>
            <Zap size={20} className={styles.statIconWarning} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {stats.uniqueContainers + trackedAppStats.uniqueContainers}
              </div>
              <div className={styles.statLabel}>Unique Items</div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className={styles.tabs}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={18} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Charts Content */}
        <div className={styles.content}>
          {activeTab === "overview" && (
            <div className={styles.chartsGrid}>
              {/* Upgrades Over Time */}
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Upgrades Over Time</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={chartData.upgradesOverTime}>
                    <defs>
                      <linearGradient id="colorSuccess" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS.success} stopOpacity={0.8} />
                        <stop offset="95%" stopColor={COLORS.success} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS.error} stopOpacity={0.8} />
                        <stop offset="95%" stopColor={COLORS.error} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="date" stroke="rgba(255,255,255,0.5)" />
                    <YAxis stroke="rgba(255,255,255,0.5)" />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="success"
                      stackId="1"
                      stroke={COLORS.success}
                      fillOpacity={1}
                      fill="url(#colorSuccess)"
                      name="Successful"
                    />
                    <Area
                      type="monotone"
                      dataKey="failed"
                      stackId="1"
                      stroke={COLORS.error}
                      fillOpacity={1}
                      fill="url(#colorFailed)"
                      name="Failed"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Weekly Activity Comparison */}
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Weekly Activity Trend</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData.weeklyComparison}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="week" stroke="rgba(255,255,255,0.5)" />
                    <YAxis stroke="rgba(255,255,255,0.5)" />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Bar dataKey="success" stackId="a" fill={COLORS.success} name="Successful" />
                    <Bar dataKey="failed" stackId="a" fill={COLORS.error} name="Failed" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Success Rate Trend */}
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Success Rate Trend</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData.successRateOverTime}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="date" stroke="rgba(255,255,255,0.5)" />
                    <YAxis stroke="rgba(255,255,255,0.5)" domain={[0, 100]} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="rate"
                      stroke={COLORS.success}
                      strokeWidth={3}
                      dot={{ fill: COLORS.success, r: 4 }}
                      name="Success Rate %"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Upgrades by Instance */}
              {chartData.upgradesByInstance.length > 1 && (
                <div className={styles.chartCard}>
                  <h3 className={styles.chartTitle}>Upgrades by Portainer Instance</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={chartData.upgradesByInstance}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" />
                      <YAxis stroke="rgba(255,255,255,0.5)" />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="count" fill={COLORS.primary} name="Upgrades">
                        {chartData.upgradesByInstance.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {activeTab === "insights" && (
            <div className={styles.chartsGrid}>
              {/* Insights & Records */}
              <div className={styles.funFactsCard}>
                <h3 className={styles.chartTitle}>📊 Insights & Records</h3>
                <div className={styles.funFacts}>
                  <div className={styles.funFact}>
                    <span className={styles.funFactLabel}>🏆 Most upgraded container:</span>
                    <span className={styles.funFactValue}>{stats.mostUpgradedContainer}</span>
                  </div>
                  <div className={styles.funFact}>
                    <span className={styles.funFactLabel}>🎯 Most reliable container:</span>
                    <span className={styles.funFactValue}>{stats.mostReliableContainer}</span>
                  </div>
                  <div className={styles.funFact}>
                    <span className={styles.funFactLabel}>⚡ Upgrade velocity:</span>
                    <span className={styles.funFactValue}>{stats.upgradeVelocity}</span>
                  </div>
                  <div className={styles.funFact}>
                    <span className={styles.funFactLabel}>🚀 Speed score:</span>
                    <span className={styles.funFactValue}>{stats.speedScore}</span>
                  </div>
                  <div className={styles.funFact}>
                    <span className={styles.funFactLabel}>⏱️ Fastest upgrade:</span>
                    <span className={styles.funFactValue}>{stats.fastestUpgrade}</span>
                  </div>
                  <div className={styles.funFact}>
                    <span className={styles.funFactLabel}>🐢 Slowest upgrade:</span>
                    <span className={styles.funFactValue}>{stats.slowestUpgrade}</span>
                  </div>
                  <div className={styles.funFact}>
                    <span className={styles.funFactLabel}>📅 Busiest day:</span>
                    <span className={styles.funFactValue}>{stats.busiestDay}</span>
                  </div>
                  <div className={styles.funFact}>
                    <span className={styles.funFactLabel}>🕐 Busiest hour:</span>
                    <span className={styles.funFactValue}>{stats.busiestHour}</span>
                  </div>
                  <div className={styles.funFact}>
                    <span className={styles.funFactLabel}>⏳ Total time upgrading:</span>
                    <span className={styles.funFactValue}>
                      {Math.round((stats.avgDuration * stats.totalUpgrades) / 60)} minutes
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "containers" && (
            <div className={styles.chartsGrid}>
              {/* Top Upgraded Containers */}
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Top 10 Most Upgraded Containers</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData.topContainers} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis type="number" stroke="rgba(255,255,255,0.5)" />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={150}
                      stroke="rgba(255,255,255,0.5)"
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" fill={COLORS.primary} name="Upgrades" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Success Rate by Container */}
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Success Rate by Container (Top 10)</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData.successRateByContainer}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis
                      dataKey="name"
                      angle={-45}
                      textAnchor="end"
                      height={100}
                      stroke="rgba(255,255,255,0.5)"
                    />
                    <YAxis domain={[0, 100]} stroke="rgba(255,255,255,0.5)" />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="rate" fill={COLORS.success} name="Success Rate %" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {activeTab === "tracked-apps" && (
            <div className={styles.chartsGrid}>
              {hasTrackedAppData ? (
                <>
                  {/* Top Upgraded Tracked Apps */}
                  <div className={styles.chartCard}>
                    <h3 className={styles.chartTitle}>Top 10 Most Upgraded Tracked Apps</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={trackedAppChartData.topContainers} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis type="number" stroke="rgba(255,255,255,0.5)" />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={150}
                          stroke="rgba(255,255,255,0.5)"
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="count" fill={COLORS.purple} name="Upgrades" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Success Rate by Tracked App */}
                  <div className={styles.chartCard}>
                    <h3 className={styles.chartTitle}>Success Rate by Tracked App (Top 10)</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={trackedAppChartData.successRateByContainer}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis
                          dataKey="name"
                          angle={-45}
                          textAnchor="end"
                          height={100}
                          stroke="rgba(255,255,255,0.5)"
                        />
                        <YAxis domain={[0, 100]} stroke="rgba(255,255,255,0.5)" />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="rate" fill={COLORS.success} name="Success Rate %" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Upgrades Over Time */}
                  <div className={styles.chartCard}>
                    <h3 className={styles.chartTitle}>Tracked App Upgrades Over Time</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={trackedAppChartData.upgradesOverTime}>
                        <defs>
                          <linearGradient id="colorTrackedSuccess" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.8} />
                            <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorTrackedFailed" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={COLORS.error} stopOpacity={0.8} />
                            <stop offset="95%" stopColor={COLORS.error} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis dataKey="date" stroke="rgba(255,255,255,0.5)" />
                        <YAxis stroke="rgba(255,255,255,0.5)" />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="success"
                          stackId="1"
                          stroke={COLORS.purple}
                          fillOpacity={1}
                          fill="url(#colorTrackedSuccess)"
                          name="Successful"
                        />
                        <Area
                          type="monotone"
                          dataKey="failed"
                          stackId="1"
                          stroke={COLORS.error}
                          fillOpacity={1}
                          fill="url(#colorTrackedFailed)"
                          name="Failed"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Upgrade Frequency */}
                  <div className={styles.chartCard}>
                    <h3 className={styles.chartTitle}>Weekly Activity Trend</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={trackedAppChartData.weeklyComparison}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis dataKey="week" stroke="rgba(255,255,255,0.5)" />
                        <YAxis stroke="rgba(255,255,255,0.5)" />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend />
                        <Bar dataKey="success" stackId="a" fill={COLORS.purple} name="Successful" />
                        <Bar dataKey="failed" stackId="a" fill={COLORS.error} name="Failed" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ) : (
                <div className={styles.chartCardWide}>
                  <div className={styles.emptyMessage}>
                    <Package size={64} className={styles.emptyIcon} />
                    <h3>No Tracked App Data</h3>
                    <p>Start upgrading tracked apps to see analytics!</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "performance" && (
            <div className={styles.chartsGrid}>
              {/* Average Duration Over Time */}
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Average Upgrade Duration Over Time</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData.avgDurationOverTime}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="date" stroke="rgba(255,255,255,0.5)" />
                    <YAxis stroke="rgba(255,255,255,0.5)" />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="avgDuration"
                      stroke={COLORS.purple}
                      strokeWidth={3}
                      dot={{ fill: COLORS.purple, r: 4 }}
                      name="Avg Duration (s)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Duration Distribution */}
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Upgrade Duration Distribution</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData.durationDistribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="range" stroke="rgba(255,255,255,0.5)" />
                    <YAxis stroke="rgba(255,255,255,0.5)" />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" fill={COLORS.cyan} name="Upgrades" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {activeTab === "patterns" && (
            <div className={styles.chartsGrid}>
              {/* Upgrades by Day of Week */}
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Upgrades by Day of Week</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData.upgradesByDayOfWeek}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="day" stroke="rgba(255,255,255,0.5)" />
                    <YAxis stroke="rgba(255,255,255,0.5)" />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" fill={COLORS.indigo} name="Upgrades" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Upgrades by Hour */}
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Upgrades by Hour of Day</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData.upgradesByHour}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="hour" stroke="rgba(255,255,255,0.5)" />
                    <YAxis stroke="rgba(255,255,255,0.5)" />
                    <Tooltip content={<CustomTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke={COLORS.pink}
                      strokeWidth={3}
                      dot={{ fill: COLORS.pink, r: 3 }}
                      name="Upgrades"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Activity Heatmap */}
              <div className={styles.chartCardWide}>
                <h3 className={styles.chartTitle}>Activity Heatmap (Day × Hour)</h3>
                <div className={styles.heatmap}>
                  <div className={styles.heatmapGrid}>
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                      <div key={day} className={styles.heatmapRow}>
                        <div className={styles.heatmapLabel}>{day}</div>
                        <div className={styles.heatmapCells}>
                          {Array.from({ length: 24 }, (_, hour) => {
                            const cellData = chartData.heatmapData.find(
                              (d) =>
                                d.day === day && d.hour === `${hour.toString().padStart(2, "0")}:00`
                            );
                            const intensity = cellData ? cellData.intensity : 0;
                            const count = cellData ? cellData.count : 0;
                            return (
                              <div
                                key={hour}
                                className={styles.heatmapCell}
                                style={{
                                  backgroundColor: `rgba(30, 144, 255, ${intensity})`,
                                }}
                                title={`${day} ${hour}:00 - ${count} upgrades`}
                              >
                                {count > 0 && <span className={styles.cellCount}>{count}</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className={styles.heatmapHourLabels}>
                    {Array.from({ length: 24 }, (_, i) => {
                      const showLabel = [0, 6, 12, 18].includes(i);
                      return (
                        <div key={i} className={styles.hourLabel}>
                          {showLabel ? `${i}:00` : ""}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

UpgradeChartsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  history: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number,
      container_name: PropTypes.string,
      old_image: PropTypes.string,
      new_image: PropTypes.string,
      old_version: PropTypes.string,
      new_version: PropTypes.string,
      status: PropTypes.string,
      created_at: PropTypes.string,
      upgrade_duration_ms: PropTypes.number,
      portainer_instance_name: PropTypes.string,
    })
  ),
};

export default UpgradeChartsModal;

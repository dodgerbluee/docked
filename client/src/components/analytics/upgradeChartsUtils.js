/**
 * Shared utilities for upgrade analytics charts
 * Used by UpgradeChartsContent and UpgradeChartsModal
 */

export const COLORS = {
  primary: "#1e90ff",
  success: "#10b981",
  error: "#ef4444",
  warning: "#f59e0b",
  purple: "#8b5cf6",
  pink: "#ec4899",
  cyan: "#06b6d4",
  indigo: "#6366f1",
};

export const CHART_COLORS = [
  COLORS.primary,
  COLORS.success,
  COLORS.purple,
  COLORS.pink,
  COLORS.cyan,
  COLORS.indigo,
  COLORS.warning,
];

/**
 * Process history data for various charts
 */
export function processChartData(history) {
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
      weeklyComparison: [],
      heatmapData: [],
    };
  }

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
    const name = upgrade.container_name || upgrade.app_name || "Unknown";
    containerCounts[name] = (containerCounts[name] || 0) + 1;
  });
  const containerUpgradeCounts = Object.entries(containerCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // 3. Success rate over time
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
    .map(([, data]) => ({
      date: data.date,
      avgDuration: Math.round(
        data.durations.reduce((a, b) => a + b, 0) / data.durations.length / 1000
      ),
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const topContainers = containerUpgradeCounts.slice(0, 10);

  // 6. Success rate by container/app (top 10)
  const containerStats = {};
  history.forEach((upgrade) => {
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
    .map(([name, s]) => ({
      name,
      rate: Math.round((s.success / s.total) * 100),
      total: s.total,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // 7. Upgrades by day of week
  const dayOfWeekCounts = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
  history.forEach((upgrade) => {
    const day = days[new Date(upgrade.created_at).getDay()];
    dayOfWeekCounts[day]++;
  });
  const upgradesByDayOfWeek = days.map((day) => ({
    day,
    count: dayOfWeekCounts[day],
  }));

  // 8. Upgrades by hour
  const hourCounts = Array(24).fill(0);
  history.forEach((upgrade) => {
    hourCounts[new Date(upgrade.created_at).getHours()]++;
  });
  const upgradesByHour = hourCounts.map((count, hour) => ({
    hour: `${hour.toString().padStart(2, "0")}:00`,
    count,
  }));

  // 9. Duration distribution
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

  // 10. Upgrades by instance
  const instanceCounts = {};
  history.forEach((upgrade) => {
    const instance = upgrade.portainer_instance_name || "Unknown";
    instanceCounts[instance] = (instanceCounts[instance] || 0) + 1;
  });
  const upgradesByInstance = Object.entries(instanceCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // 11. Weekly comparison
  const weeklyActivity = {};
  history.forEach((upgrade) => {
    const date = new Date(upgrade.created_at);
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
    .sort((a, b) => new Date(a.week) - new Date(b.week))
    .slice(-8);

  // 12. Heatmap
  const activityMatrix = {};
  history.forEach((upgrade) => {
    const date = new Date(upgrade.created_at);
    const day = days[date.getDay()];
    const hour = date.getHours();
    const key = `${day}-${hour}`;
    activityMatrix[key] = (activityMatrix[key] || 0) + 1;
  });
  const maxActivity = Math.max(...Object.values(activityMatrix), 1);
  const heatmapData = [];
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
 * Calculate summary statistics from history
 */
export function calculateStats(history) {
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

  const reliableContainers = Object.entries(containerSuccessRates)
    .filter(([, stats]) => stats.total >= 3)
    .map(([name, stats]) => ({
      name,
      rate: (stats.success / stats.total) * 100,
      total: stats.total,
    }))
    .sort((a, b) => b.rate - a.rate || b.total - a.total);
  const mostReliableContainer = reliableContainers.length > 0 ? reliableContainers[0].name : "N/A";

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayCounts = Array(7).fill(0);
  const hourCounts = Array(24).fill(0);
  history.forEach((u) => {
    const date = new Date(u.created_at);
    dayCounts[date.getDay()]++;
    hourCounts[date.getHours()]++;
  });
  const busiestDayIndex = dayCounts.indexOf(Math.max(...dayCounts));
  const busiestHourIndex = hourCounts.indexOf(Math.max(...hourCounts));

  const sortedHistory = [...history].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  );
  const firstUpgrade = new Date(sortedHistory[0]?.created_at);
  const lastUpgrade = new Date(sortedHistory[sortedHistory.length - 1]?.created_at);
  const daysDiff = Math.max(1, Math.ceil((lastUpgrade - firstUpgrade) / (1000 * 60 * 60 * 24)));
  const upgradeVelocity = (history.length / daysDiff).toFixed(1);

  let speedScore = "D";
  const avgDurationSeconds = avgDuration / 1000;
  if (avgDurationSeconds < 30) speedScore = "A+";
  else if (avgDurationSeconds < 60) speedScore = "A";
  else if (avgDurationSeconds < 120) speedScore = "B";
  else if (avgDurationSeconds < 300) speedScore = "C";

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
    busiestDay: dayNames[busiestDayIndex],
    busiestHour: `${busiestHourIndex.toString().padStart(2, "0")}:00`,
    upgradeVelocity: `${upgradeVelocity}/day`,
    speedScore,
    fastestUpgrade,
    slowestUpgrade,
    mostReliableContainer,
  };
}

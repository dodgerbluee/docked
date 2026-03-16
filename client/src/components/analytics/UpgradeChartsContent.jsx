/**
 * UpgradeChartsContent Component
 * Stats bar and chart panels for upgrade analytics (used by Analytics page; no modal wrapper)
 */

import React, { useMemo } from "react";
import PropTypes from "prop-types";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Target, Award, Clock, Zap, BarChart3, Package, Cpu } from "lucide-react";
import { processChartData, calculateStats, COLORS, CHART_COLORS } from "./upgradeChartsUtils";
import { useRunnerApps } from "../../hooks/useRunnerApps";
import { ANALYTICS_VIEW_TABS } from "../../constants/analyticsPage";
import styles from "./UpgradeChartsContent.module.css";

function CustomTooltip({ active, payload, label }) {
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
}

function UpgradeChartsContent({ containerHistory = [], trackedAppHistory = [], activeViewTab }) {
  const chartData = useMemo(() => processChartData(containerHistory), [containerHistory]);
  const stats = useMemo(() => calculateStats(containerHistory), [containerHistory]);
  const trackedAppChartData = useMemo(
    () => processChartData(trackedAppHistory),
    [trackedAppHistory]
  );
  const trackedAppStats = useMemo(() => calculateStats(trackedAppHistory), [trackedAppHistory]);

  // ── Apps tab: dockhand runner apps data ──
  const { allApps, history: appsHistory, stats: appsStats, loading: appsLoading } = useRunnerApps();

  const appsChartData = useMemo(() => {
    if (!allApps || allApps.length === 0) return null;

    // Update status distribution
    const updateStatus = [
      { name: "Up to date", value: appsStats.upToDate },
      { name: "Update available", value: appsStats.withUpdates },
    ];

    // Apps by runner
    const appsByRunner = (appsStats.appsByRunnerCount || [])
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);

    // System updates
    const systemUpdates = [
      { name: "Updates available", value: appsStats.withSystemUpdates },
      { name: "No updates", value: allApps.length - appsStats.withSystemUpdates },
    ];

    // Operation results from history
    const opSuccess = appsStats.successfulOps;
    const opFailed = appsStats.failedOps;
    const opRunning = appsHistory.filter((h) => h.exitCode === null && !h.finishedAt).length;
    const opResults = [
      { name: "Successful", value: opSuccess },
      { name: "Failed", value: opFailed },
      ...(opRunning > 0 ? [{ name: "Running", value: opRunning }] : []),
    ];

    // Operations over time (group by date)
    const opsByDate = {};
    appsHistory.forEach((h) => {
      const date = new Date(h.startedAt).toLocaleDateString();
      if (!opsByDate[date]) opsByDate[date] = { date, success: 0, failed: 0 };
      if (h.exitCode === 0) opsByDate[date].success++;
      else if (h.exitCode !== null) opsByDate[date].failed++;
    });
    const opsOverTime = Object.values(opsByDate).sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );

    // Top apps by operation count
    const opCountByApp = {};
    appsHistory.forEach((h) => {
      const name = h.operationName || "Unknown";
      opCountByApp[name] = (opCountByApp[name] || 0) + 1;
    });
    const topOps = Object.entries(opCountByApp)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { updateStatus, appsByRunner, systemUpdates, opResults, opsOverTime, topOps };
  }, [allApps, appsHistory, appsStats]);

  const hasContainerData = containerHistory.length > 0;
  const hasTrackedAppData = trackedAppHistory.length > 0;
  const hasAppsData = !appsLoading && appsChartData !== null;

  if (!hasContainerData && !hasTrackedAppData && !hasAppsData) {
    return (
      <div className={styles.content}>
        <div className={styles.emptyMessage}>
          <BarChart3 size={64} className={styles.emptyIcon} aria-hidden="true" />
          <h3>No data yet</h3>
          <p>Upgrade containers or tracked repos to see analytics here.</p>
        </div>
      </div>
    );
  }

  const totalUpgrades = stats.totalUpgrades + trackedAppStats.totalUpgrades;
  const combinedSuccessRate =
    totalUpgrades > 0
      ? Math.round(
          (stats.totalUpgrades * stats.successRate +
            trackedAppStats.totalUpgrades * trackedAppStats.successRate) /
            totalUpgrades
        )
      : hasContainerData
        ? stats.successRate
        : trackedAppStats.successRate;
  const combinedAvgDuration =
    totalUpgrades > 0
      ? Math.round(
          (stats.totalUpgrades * stats.avgDuration +
            trackedAppStats.totalUpgrades * trackedAppStats.avgDuration) /
            totalUpgrades
        )
      : hasContainerData
        ? stats.avgDuration
        : trackedAppStats.avgDuration;

  const overviewChartData = hasContainerData ? chartData : trackedAppChartData;
  const overviewStats = hasContainerData ? stats : trackedAppStats;

  return (
    <div className={styles.content}>
      {(hasContainerData || hasTrackedAppData) && (
        <div className={styles.statsBar}>
          <div className={styles.statItem}>
            <Target size={20} className={styles.statIcon} aria-hidden="true" />
            <div className={styles.statContent}>
              <div className={styles.statValue}>{totalUpgrades}</div>
              <div className={styles.statLabel}>Total upgrades</div>
            </div>
          </div>
          <div className={styles.statItem}>
            <Award size={20} className={styles.statIconSuccess} aria-hidden="true" />
            <div className={styles.statContent}>
              <div className={styles.statValue}>{combinedSuccessRate}%</div>
              <div className={styles.statLabel}>Success rate</div>
            </div>
          </div>
          <div className={styles.statItem}>
            <Clock size={20} className={styles.statIcon} aria-hidden="true" />
            <div className={styles.statContent}>
              <div className={styles.statValue}>{combinedAvgDuration}s</div>
              <div className={styles.statLabel}>Avg duration</div>
            </div>
          </div>
          <div className={styles.statItem}>
            <Zap size={20} className={styles.statIconWarning} aria-hidden="true" />
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {stats.uniqueContainers + trackedAppStats.uniqueContainers}
              </div>
              <div className={styles.statLabel}>Unique items</div>
            </div>
          </div>
        </div>
      )}

      {activeViewTab === ANALYTICS_VIEW_TABS.OVERVIEW && (
        <div className={styles.chartsGrid}>
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Upgrades over time</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={overviewChartData.upgradesOverTime}>
                <defs>
                  <linearGradient id="contentColorSuccess" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.success} stopOpacity={0.8} />
                    <stop offset="95%" stopColor={COLORS.success} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="contentColorFailed" x1="0" y1="0" x2="0" y2="1">
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
                  fill="url(#contentColorSuccess)"
                  name="Successful"
                />
                <Area
                  type="monotone"
                  dataKey="failed"
                  stackId="1"
                  stroke={COLORS.error}
                  fillOpacity={1}
                  fill="url(#contentColorFailed)"
                  name="Failed"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Weekly activity trend</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={overviewChartData.weeklyComparison}>
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
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Success rate trend</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={overviewChartData.successRateOverTime}>
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
                  name="Success rate %"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {overviewChartData.upgradesByInstance.length > 1 && (
            <div className={styles.chartCard}>
              <h3 className={styles.chartTitle}>Upgrades by Source Instance</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={overviewChartData.upgradesByInstance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                  <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" />
                  <YAxis stroke="rgba(255,255,255,0.5)" />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" fill={COLORS.primary} name="Upgrades">
                    {overviewChartData.upgradesByInstance.map((entry, index) => (
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

      {activeViewTab === ANALYTICS_VIEW_TABS.INSIGHTS && (
        <div className={styles.chartsGrid}>
          <div className={styles.funFactsCard}>
            <h3 className={styles.chartTitle}>Insights &amp; records</h3>
            <div className={styles.funFacts}>
              <div className={styles.funFact}>
                <span className={styles.funFactLabel}>Most upgraded:</span>
                <span className={styles.funFactValue}>{overviewStats.mostUpgradedContainer}</span>
              </div>
              <div className={styles.funFact}>
                <span className={styles.funFactLabel}>Most reliable:</span>
                <span className={styles.funFactValue}>{overviewStats.mostReliableContainer}</span>
              </div>
              <div className={styles.funFact}>
                <span className={styles.funFactLabel}>Upgrade velocity:</span>
                <span className={styles.funFactValue}>{overviewStats.upgradeVelocity}</span>
              </div>
              <div className={styles.funFact}>
                <span className={styles.funFactLabel}>Speed score:</span>
                <span className={styles.funFactValue}>{overviewStats.speedScore}</span>
              </div>
              <div className={styles.funFact}>
                <span className={styles.funFactLabel}>Fastest upgrade:</span>
                <span className={styles.funFactValue}>{overviewStats.fastestUpgrade}</span>
              </div>
              <div className={styles.funFact}>
                <span className={styles.funFactLabel}>Slowest upgrade:</span>
                <span className={styles.funFactValue}>{overviewStats.slowestUpgrade}</span>
              </div>
              <div className={styles.funFact}>
                <span className={styles.funFactLabel}>Busiest day:</span>
                <span className={styles.funFactValue}>{overviewStats.busiestDay}</span>
              </div>
              <div className={styles.funFact}>
                <span className={styles.funFactLabel}>Busiest hour:</span>
                <span className={styles.funFactValue}>{overviewStats.busiestHour}</span>
              </div>
              <div className={styles.funFact}>
                <span className={styles.funFactLabel}>Total time upgrading:</span>
                <span className={styles.funFactValue}>
                  {Math.round((overviewStats.avgDuration * overviewStats.totalUpgrades) / 60)} min
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeViewTab === ANALYTICS_VIEW_TABS.CONTAINERS && (
        <div className={styles.chartsGrid}>
          {hasContainerData ? (
            <>
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Top 10 most upgraded containers</h3>
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
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Success rate by container (top 10)</h3>
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
                    <Bar dataKey="rate" fill={COLORS.success} name="Success rate %" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <div className={styles.chartCardWide}>
              <div className={styles.emptyMessage}>
                <BarChart3 size={64} className={styles.emptyIcon} aria-hidden="true" />
                <h3>No container data</h3>
                <p>Include container upgrades in the sidebar to see charts here.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {activeViewTab === ANALYTICS_VIEW_TABS.TRACKED_APPS && (
        <div className={styles.chartsGrid}>
          {hasTrackedAppData ? (
            <>
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Top 10 most upgraded tracked repos</h3>
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
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Success rate by tracked repo (top 10)</h3>
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
                    <Bar dataKey="rate" fill={COLORS.success} name="Success rate %" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Tracked repo upgrades over time</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={trackedAppChartData.upgradesOverTime}>
                    <defs>
                      <linearGradient id="contentTrackedSuccess" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.8} />
                        <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="contentTrackedFailed" x1="0" y1="0" x2="0" y2="1">
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
                      fill="url(#contentTrackedSuccess)"
                      name="Successful"
                    />
                    <Area
                      type="monotone"
                      dataKey="failed"
                      stackId="1"
                      stroke={COLORS.error}
                      fillOpacity={1}
                      fill="url(#contentTrackedFailed)"
                      name="Failed"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Weekly activity trend</h3>
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
                <Package size={64} className={styles.emptyIcon} aria-hidden="true" />
                <h3>No tracked repo data</h3>
                <p>Include tracked repo upgrades in the sidebar to see charts here.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {activeViewTab === ANALYTICS_VIEW_TABS.APPS && (
        <div className={styles.chartsGrid}>
          {hasAppsData ? (
            <>
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>App update status</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={appsChartData.updateStatus}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, value }) => `${name} (${value})`}
                    >
                      <Cell fill={COLORS.success} />
                      <Cell fill={COLORS.warning} />
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {appsChartData.appsByRunner.length > 0 && (
                <div className={styles.chartCard}>
                  <h3 className={styles.chartTitle}>Apps by runner</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={appsChartData.appsByRunner}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" />
                      <YAxis stroke="rgba(255,255,255,0.5)" allowDecimals={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="count" fill={COLORS.primary} name="Apps">
                        {appsChartData.appsByRunner.map((entry, index) => (
                          <Cell
                            key={`runner-${index}`}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Operation results</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={appsChartData.opResults}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, value }) => `${name} (${value})`}
                    >
                      {appsChartData.opResults.map((entry, index) => {
                        const opColors = {
                          Successful: COLORS.success,
                          Failed: COLORS.error,
                          Running: COLORS.cyan,
                        };
                        return (
                          <Cell
                            key={`op-${index}`}
                            fill={opColors[entry.name] || CHART_COLORS[index % CHART_COLORS.length]}
                          />
                        );
                      })}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {appsChartData.opsOverTime.length > 1 && (
                <div className={styles.chartCard}>
                  <h3 className={styles.chartTitle}>Operations over time</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={appsChartData.opsOverTime}>
                      <defs>
                        <linearGradient id="appsOpsSuccess" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={COLORS.success} stopOpacity={0.8} />
                          <stop offset="95%" stopColor={COLORS.success} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="appsOpsFailed" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={COLORS.error} stopOpacity={0.8} />
                          <stop offset="95%" stopColor={COLORS.error} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis dataKey="date" stroke="rgba(255,255,255,0.5)" />
                      <YAxis stroke="rgba(255,255,255,0.5)" allowDecimals={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="success"
                        stackId="1"
                        stroke={COLORS.success}
                        fillOpacity={1}
                        fill="url(#appsOpsSuccess)"
                        name="Successful"
                      />
                      <Area
                        type="monotone"
                        dataKey="failed"
                        stackId="1"
                        stroke={COLORS.error}
                        fillOpacity={1}
                        fill="url(#appsOpsFailed)"
                        name="Failed"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              {appsChartData.topOps.length > 0 && (
                <div className={styles.chartCard}>
                  <h3 className={styles.chartTitle}>Most run operations</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={appsChartData.topOps} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis type="number" stroke="rgba(255,255,255,0.5)" allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={150}
                        stroke="rgba(255,255,255,0.5)"
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="count" fill={COLORS.cyan} name="Runs">
                        {appsChartData.topOps.map((entry, index) => (
                          <Cell
                            key={`top-op-${index}`}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>System updates</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={appsChartData.systemUpdates}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, value }) => `${name} (${value})`}
                    >
                      <Cell fill={COLORS.warning} />
                      <Cell fill={COLORS.success} />
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <div className={styles.chartCardWide}>
              <div className={styles.emptyMessage}>
                <Cpu size={64} className={styles.emptyIcon} aria-hidden="true" />
                <h3>No apps data</h3>
                <p>Configure runners with apps in their dockhand config to see analytics here.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {activeViewTab === ANALYTICS_VIEW_TABS.PERFORMANCE && (
        <div className={styles.chartsGrid}>
          {hasContainerData ? (
            <>
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Average upgrade duration over time</h3>
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
                      name="Avg duration (s)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Upgrade duration distribution</h3>
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
            </>
          ) : (
            <div className={styles.chartCardWide}>
              <div className={styles.emptyMessage}>
                <Zap size={64} className={styles.emptyIcon} aria-hidden="true" />
                <h3>No container data</h3>
                <p>Performance charts use container upgrade history.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {activeViewTab === ANALYTICS_VIEW_TABS.PATTERNS && (
        <div className={styles.chartsGrid}>
          {hasContainerData ? (
            <>
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Upgrades by day of week</h3>
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
              <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>Upgrades by hour of day</h3>
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
              <div className={styles.chartCardWide}>
                <h3 className={styles.chartTitle}>Activity heatmap (day × hour)</h3>
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
                                title={`${day} ${hour}:00 – ${count} upgrades`}
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
                    {Array.from({ length: 24 }, (_, i) => (
                      <div key={i} className={styles.hourLabel}>
                        {[0, 6, 12, 18].includes(i) ? `${i}:00` : ""}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className={styles.chartCardWide}>
              <div className={styles.emptyMessage}>
                <BarChart3 size={64} className={styles.emptyIcon} aria-hidden="true" />
                <h3>No container data</h3>
                <p>Pattern charts use container upgrade history.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

UpgradeChartsContent.propTypes = {
  containerHistory: PropTypes.arrayOf(PropTypes.object),
  trackedAppHistory: PropTypes.arrayOf(PropTypes.object),
  activeViewTab: PropTypes.string.isRequired,
};

export default UpgradeChartsContent;

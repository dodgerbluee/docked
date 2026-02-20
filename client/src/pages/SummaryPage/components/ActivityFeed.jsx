import React, { useMemo } from "react";
import PropTypes from "prop-types";
import {
  Clock,
  Package,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  ArrowUp,
  XCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useUpgradeHistory } from "../../../hooks/useUpgradeHistory";
import { useTrackedAppUpgradeHistory } from "../../../hooks/useTrackedAppUpgradeHistory";
import styles from "./ActivityFeed.module.css";

/**
 * Parse API timestamp as UTC when it has no timezone (e.g. SQLite "YYYY-MM-DD HH:MM:SS").
 * Prevents "in about 6 hours" when server stores UTC and client parses as local.
 */
function parseUtcIfNeeded(dateStr) {
  if (!dateStr) return new Date(NaN);
  const s = String(dateStr).trim();
  if (s.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(s.replace(" ", "T") + "Z");
}

/**
 * Activity feed showing recent changes and events
 */
const ActivityFeed = ({ containers, trackedApps, recentRuns, latestRunsByJobType }) => {
  // Fetch recent upgrade history
  const { history } = useUpgradeHistory({ limit: 10 });
  const { history: trackedAppHistory } = useTrackedAppUpgradeHistory();

  const activities = useMemo(() => {
    const items = [];

    // Add recent container upgrades (individual items)
    if (history && history.length > 0) {
      history.slice(0, 5).forEach((upgrade) => {
        const timestamp = parseUtcIfNeeded(upgrade.created_at);
        if (isNaN(timestamp.getTime())) return;

        const isSuccess = upgrade.status === "success";
        items.push({
          id: `upgrade-${upgrade.id}`,
          type: "upgrade",
          icon: isSuccess ? CheckCircle : XCircle,
          title: upgrade.container_name,
          description: `Upgraded to ${upgrade.new_version || upgrade.new_image}`,
          timestamp,
          status: isSuccess ? "success" : "error",
        });
      });
    }

    // Add recent tracked app upgrades
    if (trackedAppHistory && trackedAppHistory.length > 0) {
      trackedAppHistory.slice(0, 5).forEach((upgrade) => {
        const timestamp = parseUtcIfNeeded(upgrade.created_at);
        if (isNaN(timestamp.getTime())) return;

        const isSuccess = upgrade.status === "success";
        items.push({
          id: `tracked-app-upgrade-${upgrade.id}`,
          type: "tracked-app-upgrade",
          icon: isSuccess ? Package : XCircle,
          title: upgrade.app_name || upgrade.repository,
          description: `Upgraded to ${upgrade.new_version}`,
          timestamp,
          status: isSuccess ? "success" : "error",
        });
      });
    }

    // Add recent batch runs
    if (recentRuns && recentRuns.length > 0) {
      recentRuns.slice(0, 3).forEach((run) => {
        // Validate timestamp before creating activity
        const timeValue = run.end_time || run.start_time;
        if (!timeValue) return; // Skip if no valid timestamp

        const timestamp = parseUtcIfNeeded(timeValue);
        if (isNaN(timestamp.getTime())) return; // Skip if invalid date

        const isSuccess = run.status === "completed";
        items.push({
          id: `run-${run.id}`,
          type: "batch",
          icon: RefreshCw,
          title: `Batch ${run.job_type === "docker-hub-pull" ? "Container" : "Tracked App"} Check`,
          description: `${run.status} - ${run.containers_checked || 0} items checked`,
          timestamp,
          status: isSuccess ? "success" : "error",
        });
      });
    }

    // Add individual containers with updates (top 5)
    const containersWithUpdates = containers.filter((c) => c.hasUpdate);
    containersWithUpdates.slice(0, 5).forEach((container) => {
      items.push({
        id: `update-${container.id}`,
        type: "available-update",
        icon: ArrowUp,
        title: container.name,
        description: `Update available: ${container.newVersion || container.latestTag || "new version"}`,
        timestamp: new Date(), // Use current time as pseudo-timestamp
        status: "warning",
      });
    });

    // Add individual tracked apps with updates (top 5)
    const trackedAppsWithUpdates = trackedApps.filter((app) => app.isBehind);
    trackedAppsWithUpdates.slice(0, 5).forEach((app) => {
      items.push({
        id: `tracked-update-${app.id}`,
        type: "tracked-update",
        icon: Package,
        title: app.label || app.repository,
        description: `${app.currentVersion} → ${app.latestVersion}`,
        timestamp: new Date(app.lastChecked || Date.now()),
        status: "warning",
      });
    });

    // Sort by timestamp (newest first)
    items.sort((a, b) => b.timestamp - a.timestamp);

    return items; // Return all items, UI will handle display limit
  }, [containers, trackedApps, recentRuns, history, trackedAppHistory]);

  const getStatusIcon = (status) => {
    switch (status) {
      case "success":
        return CheckCircle;
      case "error":
        return AlertCircle;
      case "warning":
        return AlertCircle;
      default:
        return Clock;
    }
  };

  return (
    <div className={styles.activityFeed}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <Clock size={20} className={styles.headerIcon} />
          <h3 className={styles.title}>Recent Activity</h3>
        </div>
      </div>

      <div className={styles.feedContent}>
        {activities.length === 0 ? (
          <div className={styles.emptyState}>
            <Clock size={32} className={styles.emptyIcon} />
            <p className={styles.emptyText}>No recent activity</p>
          </div>
        ) : (
          <div className={styles.activityList}>
            {activities.map((activity) => {
              const Icon = activity.icon;
              const StatusIcon = getStatusIcon(activity.status);

              return (
                <div key={activity.id} className={styles.activityItem}>
                  <div className={`${styles.iconWrapper} ${styles[activity.status]}`}>
                    <Icon size={16} />
                  </div>
                  <div className={styles.activityContent}>
                    <div className={styles.activityHeader}>
                      <span className={styles.activityTitle}>{activity.title}</span>
                      <StatusIcon
                        size={14}
                        className={`${styles.statusIcon} ${styles[`status-${activity.status}`]}`}
                      />
                    </div>
                    {activity.description && (
                      <p className={styles.activityDescription}>{activity.description}</p>
                    )}
                    <span className={styles.activityTime}>
                      {activity.timestamp && !isNaN(activity.timestamp.getTime())
                        ? formatDistanceToNow(activity.timestamp, { addSuffix: true })
                        : "Recently"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

ActivityFeed.propTypes = {
  containers: PropTypes.array,
  trackedApps: PropTypes.array,
  recentRuns: PropTypes.array,
  latestRunsByJobType: PropTypes.object,
};

ActivityFeed.defaultProps = {
  containers: [],
  trackedApps: [],
  recentRuns: [],
  latestRunsByJobType: {},
};

export default ActivityFeed;

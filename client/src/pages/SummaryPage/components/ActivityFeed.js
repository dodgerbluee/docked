import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Clock, Package, RefreshCw, CheckCircle, AlertCircle, TrendingUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import styles from "./ActivityFeed.module.css";

/**
 * Activity feed showing recent changes and events
 */
const ActivityFeed = ({ containers, trackedApps, recentRuns, latestRunsByJobType }) => {
  const activities = useMemo(() => {
    const items = [];

    // Add recent batch runs
    if (recentRuns && recentRuns.length > 0) {
      recentRuns.slice(0, 3).forEach((run) => {
        // Validate timestamp before creating activity
        const timeValue = run.end_time || run.start_time;
        if (!timeValue) return; // Skip if no valid timestamp
        
        const timestamp = new Date(timeValue);
        if (isNaN(timestamp.getTime())) return; // Skip if invalid date
        
        const isSuccess = run.status === "completed";
        items.push({
          id: `run-${run.id}`,
          type: "batch",
          icon: RefreshCw,
          title: `Batch ${run.job_type === "docker-hub-pull" ? "Container" : "Tracked App"} Check`,
          description: `Status: ${run.status} - ${run.containers_checked || 0} items checked`,
          timestamp,
          status: isSuccess ? "success" : "error",
        });
      });
    }

    // Add containers with updates
    const containersWithUpdates = containers.filter((c) => c.hasUpdate);
    if (containersWithUpdates.length > 0) {
      items.push({
        id: "containers-updates",
        type: "update",
        icon: TrendingUp,
        title: `${containersWithUpdates.length} Container Update${containersWithUpdates.length !== 1 ? "s" : ""} Available`,
        description: containersWithUpdates
          .slice(0, 3)
          .map((c) => c.name)
          .join(", "),
        timestamp: new Date(),
        status: "warning",
      });
    }

    // Add tracked apps with updates
    const trackedAppsWithUpdates = trackedApps.filter((app) => app.isBehind);
    if (trackedAppsWithUpdates.length > 0) {
      items.push({
        id: "tracked-apps-updates",
        type: "update",
        icon: Package,
        title: `${trackedAppsWithUpdates.length} Tracked App Update${trackedAppsWithUpdates.length !== 1 ? "s" : ""} Available`,
        description: trackedAppsWithUpdates
          .slice(0, 3)
          .map((app) => app.label || app.repository)
          .join(", "),
        timestamp: new Date(),
        status: "warning",
      });
    }

    // Sort by timestamp (newest first)
    items.sort((a, b) => b.timestamp - a.timestamp);

    return items.slice(0, 10); // Limit to 10 items
  }, [containers, trackedApps, recentRuns]);

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

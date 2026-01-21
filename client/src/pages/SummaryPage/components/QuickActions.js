import React from "react";
import PropTypes from "prop-types";
import { Plus, Server, Package, Zap } from "lucide-react";
import styles from "./QuickActions.module.css";

/**
 * Quick actions panel for common tasks
 */
const QuickActions = ({
  onNavigateToPortainer,
  onNavigateToTrackedApps,
  onAddInstance,
  hasInstances,
}) => {
  const actions = [];

  if (!hasInstances) {
      actions.push({
        id: "add-instance",
        icon: Plus,
        label: "Add Portainer Instance",
        description: "Connect to a Portainer server",
        color: "blue",
        onClick: onAddInstance,
      });
    } else {
      actions.push({
        id: "view-containers",
        icon: Server,
        label: "View Containers",
        description: "Manage all containers",
        color: "blue",
        onClick: onNavigateToPortainer,
      });
    }

  actions.push({
      id: "tracked-apps",
      icon: Package,
      label: "Tracked Apps",
      description: "Monitor app versions",
      color: "indigo",
      onClick: onNavigateToTrackedApps,
    });

  if (actions.length === 0) {
    return null;
  }

  return (
    <div className={styles.quickActions}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <Zap size={20} className={styles.headerIcon} />
          <h3 className={styles.title}>Quick Actions</h3>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.actionsList}>
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                className={`${styles.actionButton} ${styles[`color-${action.color}`]}`}
                onClick={action.onClick}
              >
                <div className={styles.actionIcon}>
                  <Icon size={20} />
                </div>
                <div className={styles.actionContent}>
                  <div className={styles.actionLabel}>{action.label}</div>
                  <div className={styles.actionDescription}>{action.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

QuickActions.propTypes = {
  onNavigateToPortainer: PropTypes.func,
  onNavigateToTrackedApps: PropTypes.func,
  onAddInstance: PropTypes.func,
  hasInstances: PropTypes.bool,
};

export default QuickActions;

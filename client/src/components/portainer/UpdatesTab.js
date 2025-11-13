import React from "react";
import PropTypes from "prop-types";
import PortainerStackGroup from "./PortainerStackGroup";
import styles from "./UpdatesTab.module.css";

/**
 * UpdatesTab Component
 * Displays containers with available updates
 */
function UpdatesTab({
  groupedStacks,
  isLoading,
  hasData,
  dockerHubDataPulled,
  lastPullTime,
  collapsedStacks,
  selectedContainers,
  upgrading,
  isPortainerContainer,
  onToggleStack,
  onToggleSelect,
  onUpgrade,
}) {
  if (isLoading && !hasData) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.loadingContainer}>
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={styles.spinner}
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <p>Loading container data from Portainer...</p>
        </div>
      </div>
    );
  }

  const hasUpdates = groupedStacks.some((stack) =>
    stack.containers.some((c) => c.hasUpdate)
  );

  if (!hasUpdates) {
    return (
      <div className={styles.emptyState}>
        <p>
          {dockerHubDataPulled
            ? "No containers with updates available."
            : hasData
            ? "No containers with updates available. Pull from Docker Hub to check for available upgrades."
            : "Pull from Docker Hub to check for available upgrades."}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.contentTabPanel}>
      <div className={styles.stacksContainer}>
        {groupedStacks.map((stack) => (
          <PortainerStackGroup
            key={`${stack.stackName}-updates`}
            stack={stack}
            containers={stack.containers}
            showUpdates={true}
            collapsed={collapsedStacks}
            selectedContainers={selectedContainers}
            upgrading={upgrading}
            isPortainerContainer={isPortainerContainer}
            onToggleStack={onToggleStack}
            onToggleSelect={onToggleSelect}
            onUpgrade={onUpgrade}
          />
        ))}
      </div>
      {lastPullTime && (
        <div className={styles.lastPullTime}>
          Last scanned: {lastPullTime.toLocaleString("en-US", {
            timeZone: "America/Chicago",
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
            hour12: true,
          })}
        </div>
      )}
    </div>
  );
}

UpdatesTab.propTypes = {
  groupedStacks: PropTypes.arrayOf(PropTypes.object).isRequired,
  isLoading: PropTypes.bool.isRequired,
  hasData: PropTypes.bool.isRequired,
  dockerHubDataPulled: PropTypes.bool.isRequired,
  lastPullTime: PropTypes.instanceOf(Date),
  collapsedStacks: PropTypes.instanceOf(Set).isRequired,
  selectedContainers: PropTypes.instanceOf(Set).isRequired,
  upgrading: PropTypes.object.isRequired,
  isPortainerContainer: PropTypes.func.isRequired,
  onToggleStack: PropTypes.func.isRequired,
  onToggleSelect: PropTypes.func.isRequired,
  onUpgrade: PropTypes.func.isRequired,
};

export default UpdatesTab;


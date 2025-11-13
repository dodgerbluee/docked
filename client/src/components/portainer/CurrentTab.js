import React from "react";
import PropTypes from "prop-types";
import PortainerStackGroup from "./PortainerStackGroup";
import styles from "./CurrentTab.module.css";

/**
 * CurrentTab Component
 * Displays containers that are up to date
 */
function CurrentTab({
  groupedStacks,
  isLoading,
  hasData,
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

  const hasUpToDate = groupedStacks.some((stack) =>
    stack.containers.some((c) => !c.hasUpdate)
  );

  if (!hasUpToDate) {
    return (
      <div className={styles.emptyState}>
        <p>
          {hasData
            ? "No up-to-date containers found."
            : "No containers found. Data will appear once fetched from Portainer."}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.contentTabPanel}>
      <div className={styles.stacksContainer}>
        {groupedStacks.map((stack) => (
          <PortainerStackGroup
            key={`${stack.stackName}-current`}
            stack={stack}
            containers={stack.containers}
            showUpdates={false}
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

CurrentTab.propTypes = {
  groupedStacks: PropTypes.arrayOf(PropTypes.object).isRequired,
  isLoading: PropTypes.bool.isRequired,
  hasData: PropTypes.bool.isRequired,
  lastPullTime: PropTypes.instanceOf(Date),
  collapsedStacks: PropTypes.instanceOf(Set).isRequired,
  selectedContainers: PropTypes.instanceOf(Set).isRequired,
  upgrading: PropTypes.object.isRequired,
  isPortainerContainer: PropTypes.func.isRequired,
  onToggleStack: PropTypes.func.isRequired,
  onToggleSelect: PropTypes.func.isRequired,
  onUpgrade: PropTypes.func.isRequired,
};

export default CurrentTab;


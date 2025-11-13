import React from "react";
import PropTypes from "prop-types";
import PortainerContainerCard from "./PortainerContainerCard";
import { STACK_NAMES } from "../../constants/portainerPage";
import styles from "./PortainerStackGroup.module.css";

/**
 * PortainerStackGroup Component
 * Displays a group of containers organized by stack
 */
const PortainerStackGroup = React.memo(function PortainerStackGroup({
  stack,
  containers,
  showUpdates,
  collapsed,
  selectedContainers,
  upgrading,
  isPortainerContainer,
  onToggleStack,
  onToggleSelect,
  onUpgrade,
}) {
  const stackContainersWithUpdates = containers.filter((c) => c.hasUpdate);
  const stackContainersUpToDate = containers.filter((c) => !c.hasUpdate);

  // If showing updates section, only show stacks with updates
  if (showUpdates && stackContainersWithUpdates.length === 0) {
    return null;
  }

  // If showing up-to-date section, only show stacks with up-to-date containers
  if (!showUpdates && stackContainersUpToDate.length === 0) {
    return null;
  }

  const stackKey = `${stack.stackName}-${showUpdates ? "updates" : "current"}`;
  const isCollapsed = collapsed.has(stackKey);
  const displayName =
    stack.stackName === STACK_NAMES.STANDALONE
      ? "Standalone Containers"
      : `Stack: ${stack.stackName}`;

  const containersToShow = showUpdates
    ? stackContainersWithUpdates
    : stackContainersUpToDate;

  return (
    <div className={styles.stackGroup}>
      <div
        className={styles.stackHeader}
        onClick={() => onToggleStack(stackKey)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleStack(stackKey);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        aria-label={`${displayName} - ${isCollapsed ? "Expand" : "Collapse"}`}
      >
        <div className={styles.stackHeaderLeft}>
          <button
            className={styles.stackToggle}
            aria-label={isCollapsed ? "Expand stack" : "Collapse stack"}
            aria-hidden="true"
            tabIndex={-1}
          >
            {isCollapsed ? "▶" : "▼"}
          </button>
          <h3 className={styles.stackName}>{displayName}</h3>
        </div>
        {!showUpdates && (
          <span className={styles.stackCount}>
            {stackContainersUpToDate.length} container
            {stackContainersUpToDate.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
            {!isCollapsed && containersToShow.length > 0 && (
              <div className={styles.containersGrid}>
                {containersToShow.map((container) => {
                  const isPortainer = isPortainerContainer(container);
                  return (
                    <PortainerContainerCard
                      key={container.id}
                      container={container}
                      isPortainer={isPortainer}
                      selected={selectedContainers.has(container.id)}
                      upgrading={upgrading[container.id] || false}
                      showUpdates={showUpdates}
                      onToggleSelect={onToggleSelect}
                      onUpgrade={onUpgrade}
                    />
                  );
                })}
              </div>
            )}
    </div>
  );
});

PortainerStackGroup.propTypes = {
  stack: PropTypes.object.isRequired,
  containers: PropTypes.arrayOf(PropTypes.object).isRequired,
  showUpdates: PropTypes.bool.isRequired,
  collapsed: PropTypes.instanceOf(Set).isRequired,
  selectedContainers: PropTypes.instanceOf(Set).isRequired,
  upgrading: PropTypes.object.isRequired,
  isPortainerContainer: PropTypes.func.isRequired,
  onToggleStack: PropTypes.func.isRequired,
  onToggleSelect: PropTypes.func.isRequired,
  onUpgrade: PropTypes.func.isRequired,
};

PortainerStackGroup.displayName = "PortainerStackGroup";

export default PortainerStackGroup;


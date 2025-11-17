import React from "react";
import PropTypes from "prop-types";
import PortainerStackGroup from "./PortainerStackGroup";
import PortainerContainerCard from "./PortainerContainerCard";
import LoadingSpinner from "../ui/LoadingSpinner";
import EmptyState from "../ui/EmptyState";
import { DATE_FORMAT_OPTIONS, STACK_NAMES } from "../../constants/portainerPage";
import styles from "./ContainersTab.module.css";

/**
 * ContainersTab Component
 * Unified component for displaying containers (updates or current)
 */
const ContainersTab = React.memo(function ContainersTab({
  groupedStacks,
  isLoading,
  hasData,
  showUpdates,
  showAll = false,
  dockerHubDataPulled,
  lastPullTime,
  collapsedStacks,
  selectedContainers,
  upgrading,
  isPortainerContainer,
  onToggleStack,
  onToggleSelect,
  onUpgrade,
  developerModeEnabled = false,
}) {
  if (isLoading && !hasData) {
    return (
      <LoadingSpinner
        size="md"
        message="Loading container data from Portainer..."
        className={styles.loadingState}
      />
    );
  }

  // For All tab: show all containers grouped by stack, with showUpdates per container
  if (showAll) {
    if (groupedStacks.length === 0) {
      const emptyMessage = hasData
        ? "No containers found."
        : "No containers found. Data will appear once fetched from Portainer.";

      return <EmptyState message={emptyMessage} className={styles.emptyState} />;
    }

    return (
      <div className={styles.contentTabPanel}>
        <div className={styles.stacksContainer}>
          {[...groupedStacks]
            .filter((stack) => stack.containers.length > 0)
            .sort((a, b) => {
              // Always put Standalone at the bottom
              const aIsStandalone = a.stackName === STACK_NAMES.STANDALONE;
              const bIsStandalone = b.stackName === STACK_NAMES.STANDALONE;

              if (aIsStandalone && !bIsStandalone) return 1;
              if (!aIsStandalone && bIsStandalone) return -1;

              // Check if stack has any containers with updates
              const aHasUpdates = a.containers.some((c) => c.hasUpdate);
              const bHasUpdates = b.containers.some((c) => c.hasUpdate);

              // First sort by hasUpdates (stacks with updates first)
              if (aHasUpdates && !bHasUpdates) return -1;
              if (!aHasUpdates && bHasUpdates) return 1;

              // Then sort alphabetically by stack name
              const nameA = (a.stackName || "").toLowerCase();
              const nameB = (b.stackName || "").toLowerCase();
              return nameA.localeCompare(nameB);
            })
            .map((stack) => {
              const stackKey = `${stack.stackName}-all`;
              const isCollapsed = collapsedStacks.has(stackKey);
              const displayName =
                stack.stackName === STACK_NAMES.STANDALONE
                  ? "Standalone Containers"
                  : `Stack: ${stack.stackName}`;

              return (
                <div key={stackKey} className={styles.stackGroup}>
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
                    <span className={styles.stackCount}>
                      {stack.containers.length} container
                      {stack.containers.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {!isCollapsed && stack.containers.length > 0 && (
                    <div className={styles.containersGrid}>
                      {[...stack.containers]
                        .sort((a, b) => {
                          // First sort by hasUpdate (updates first)
                          if (a.hasUpdate && !b.hasUpdate) return -1;
                          if (!a.hasUpdate && b.hasUpdate) return 1;
                          // Then sort alphabetically by container name
                          const nameA = (a.name || "").toLowerCase();
                          const nameB = (b.name || "").toLowerCase();
                          return nameA.localeCompare(nameB);
                        })
                        .map((container) => {
                          const isPortainer = isPortainerContainer(container);
                          return (
                            <PortainerContainerCard
                              key={container.id}
                              container={container}
                              isPortainer={isPortainer}
                              selected={selectedContainers.has(container.id)}
                              upgrading={upgrading[container.id] || false}
                              showUpdates={container.hasUpdate}
                              onToggleSelect={onToggleSelect}
                              onUpgrade={onUpgrade}
                              developerModeEnabled={developerModeEnabled}
                            />
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
        {lastPullTime && (
          <div className={styles.lastPullTime} aria-live="polite">
            Last scanned: {lastPullTime.toLocaleString("en-US", DATE_FORMAT_OPTIONS)}
          </div>
        )}
      </div>
    );
  }

  // For Updates tab: single dropdown with containers organized by Portainer instance
  // For Current tab: keep stack grouping
  if (showUpdates) {
    // Collect all containers with updates, grouped by Portainer instance
    const allContainersWithUpdates = groupedStacks.flatMap((stack) =>
      stack.containers.filter((c) => c.hasUpdate)
    );

    if (allContainersWithUpdates.length === 0) {
      const emptyMessage = dockerHubDataPulled
        ? "No containers with updates available."
        : hasData
          ? "No containers with updates available. Pull from Docker Hub to check for available upgrades."
          : "Pull from Docker Hub to check for available upgrades.";

      return <EmptyState message={emptyMessage} className={styles.emptyState} />;
    }

    // Group containers by Portainer instance and sort
    const containersByPortainer = allContainersWithUpdates.reduce((acc, container) => {
      const portainerName = container.portainerName || "Unknown";
      if (!acc[portainerName]) {
        acc[portainerName] = [];
      }
      acc[portainerName].push(container);
      return acc;
    }, {});

    // Sort Portainer instances alphabetically
    const sortedPortainerNames = Object.keys(containersByPortainer).sort((a, b) => {
      if (a === "Unknown") return 1;
      if (b === "Unknown") return -1;
      return a.localeCompare(b);
    });

    // Single "Updates" collapsible section
    const updatesKey = "updates-all";
    const isCollapsed = collapsedStacks.has(updatesKey);

    return (
      <div className={styles.contentTabPanel}>
        <div className={styles.stacksContainer}>
          <div className={styles.stackGroup}>
            <div
              className={styles.stackHeader}
              onClick={() => onToggleStack(updatesKey)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggleStack(updatesKey);
                }
              }}
              role="button"
              tabIndex={0}
              aria-expanded={!isCollapsed}
              aria-label={`Updates - ${isCollapsed ? "Expand" : "Collapse"}`}
            >
              <div className={styles.stackHeaderLeft}>
                <button
                  className={styles.stackToggle}
                  aria-label={isCollapsed ? "Expand updates" : "Collapse updates"}
                  aria-hidden="true"
                  tabIndex={-1}
                >
                  {isCollapsed ? "▶" : "▼"}
                </button>
                <h3 className={styles.stackName}>Updates</h3>
              </div>
            </div>
            {!isCollapsed && (
              <div className={styles.containersGrid}>
                {sortedPortainerNames.map((portainerName) =>
                  containersByPortainer[portainerName].map((container) => {
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
                        developerModeEnabled={developerModeEnabled}
                      />
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
        {lastPullTime && (
          <div className={styles.lastPullTime} aria-live="polite">
            Last scanned: {lastPullTime.toLocaleString("en-US", DATE_FORMAT_OPTIONS)}
          </div>
        )}
      </div>
    );
  }

  // For Current tab: keep stack grouping
  const filteredStacks = groupedStacks.filter((stack) =>
    stack.containers.some((c) => !c.hasUpdate)
  );

  if (filteredStacks.length === 0) {
    const emptyMessage = hasData
      ? "No up-to-date containers found."
      : "No containers found. Data will appear once fetched from Portainer.";

    return <EmptyState message={emptyMessage} className={styles.emptyState} />;
  }

  return (
    <div className={styles.contentTabPanel}>
      <div className={styles.stacksContainer}>
        {filteredStacks.map((stack) => (
          <PortainerStackGroup
            key={`${stack.stackName}-current`}
            stack={stack}
            containers={stack.containers}
            showUpdates={showUpdates}
            collapsed={collapsedStacks}
            selectedContainers={selectedContainers}
            upgrading={upgrading}
            isPortainerContainer={isPortainerContainer}
            onToggleStack={onToggleStack}
            onToggleSelect={onToggleSelect}
            onUpgrade={onUpgrade}
            developerModeEnabled={developerModeEnabled}
          />
        ))}
      </div>
      {lastPullTime && (
        <div className={styles.lastPullTime} aria-live="polite">
          Last scanned: {lastPullTime.toLocaleString("en-US", DATE_FORMAT_OPTIONS)}
        </div>
      )}
    </div>
  );
});

ContainersTab.propTypes = {
  groupedStacks: PropTypes.arrayOf(PropTypes.object).isRequired,
  isLoading: PropTypes.bool.isRequired,
  hasData: PropTypes.bool.isRequired,
  showUpdates: PropTypes.bool,
  showAll: PropTypes.bool,
  dockerHubDataPulled: PropTypes.bool,
  lastPullTime: PropTypes.instanceOf(Date),
  collapsedStacks: PropTypes.instanceOf(Set).isRequired,
  selectedContainers: PropTypes.instanceOf(Set).isRequired,
  upgrading: PropTypes.object.isRequired,
  isPortainerContainer: PropTypes.func.isRequired,
  onToggleStack: PropTypes.func.isRequired,
  onToggleSelect: PropTypes.func.isRequired,
  onUpgrade: PropTypes.func.isRequired,
};

ContainersTab.displayName = "ContainersTab";

export default ContainersTab;

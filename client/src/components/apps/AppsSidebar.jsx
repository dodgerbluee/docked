/**
 * AppsSidebar
 * Sidebar for the Apps page. Provides view switching (All / By Runner)
 * and per-runner filtering when multiple runners are configured.
 * Mirrors the TrackedAppsSidebar pattern.
 */

import React, { memo } from "react";
import PropTypes from "prop-types";
import { Layers, Server } from "lucide-react";
import styles from "./AppsSidebar.module.css";

export const APPS_VIEWS = {
  ALL: "all",
  GROUPED: "grouped",
};

const AppsSidebar = memo(function AppsSidebar({
  view,
  onViewChange,
  runners,
  selectedRunners,
  onSelectedRunnersChange,
  totalOps,
}) {
  const handleRunnerToggle = (runnerId, checked) => {
    onSelectedRunnersChange((prev) => {
      if (checked) {
        const next = new Set(prev);
        next.add(runnerId);
        // If all runners are now in the set, clear it to mean "show all"
        if (runners.every((r) => next.has(r.id))) return new Set();
        return next;
      } else {
        if (prev.size === 0) {
          // Was "all selected" → populate with everyone except this runner
          const next = new Set(runners.map((r) => r.id));
          next.delete(runnerId);
          return next;
        }
        const next = new Set(prev);
        next.delete(runnerId);
        return next;
      }
    });
  };

  return (
    <div className={styles.sidebar}>
      {/* Views toolbar */}
      <div className={styles.viewsToolbar}>
        <button
          className={`${styles.sidebarItem} ${view === APPS_VIEWS.ALL ? styles.active : ""}`}
          onClick={() => onViewChange(APPS_VIEWS.ALL)}
        >
          <Layers size={16} className={styles.sidebarItemIcon} />
          <span className={styles.sidebarItemName}>All Apps</span>
          {totalOps > 0 && <span className={styles.countBadge}>{totalOps}</span>}
        </button>
        <button
          className={`${styles.sidebarItem} ${view === APPS_VIEWS.GROUPED ? styles.active : ""}`}
          onClick={() => onViewChange(APPS_VIEWS.GROUPED)}
        >
          <Server size={16} className={styles.sidebarItemIcon} />
          <span className={styles.sidebarItemName}>By Runner</span>
        </button>
      </div>

      {/* Runner filter — only shown when there are multiple runners */}
      {runners.length > 1 && (
        <>
          <div className={styles.sidebarHeader}>
            <h3>Filter by Runner</h3>
          </div>
          <div className={styles.filterContainer}>
            <div className={styles.filterBox}>
              {runners.map((runner) => {
                const isChecked = selectedRunners.size === 0 || selectedRunners.has(runner.id);
                return (
                  <div key={runner.id} className={styles.filterLabel}>
                    <label className={styles.checkbox}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => handleRunnerToggle(runner.id, e.target.checked)}
                        aria-label={`Filter by ${runner.name}`}
                      />
                    </label>
                    <span
                      className={styles.filterText}
                      onClick={() => handleRunnerToggle(runner.id, !isChecked)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleRunnerToggle(runner.id, !isChecked);
                        }
                      }}
                    >
                      {runner.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
});

AppsSidebar.displayName = "AppsSidebar";

AppsSidebar.propTypes = {
  view: PropTypes.oneOf([APPS_VIEWS.ALL, APPS_VIEWS.GROUPED]).isRequired,
  onViewChange: PropTypes.func.isRequired,
  runners: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number.isRequired,
      name: PropTypes.string.isRequired,
    })
  ).isRequired,
  selectedRunners: PropTypes.instanceOf(Set).isRequired,
  onSelectedRunnersChange: PropTypes.func.isRequired,
  totalOps: PropTypes.number.isRequired,
};

export default AppsSidebar;

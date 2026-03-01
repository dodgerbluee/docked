/**
 * AppsSidebar
 * Sidebar for the Apps page. Provides view switching (All / By Runner)
 * and per-runner filtering when multiple runners are configured.
 * Mirrors the TrackedAppsSidebar pattern.
 */

import React, { memo } from "react";
import PropTypes from "prop-types";
import { Layers, Server, ArrowUpCircle, History, Plus, Settings } from "lucide-react";
import styles from "./AppsSidebar.module.css";

export const APPS_VIEWS = {
  UPDATES: "updates",
  ALL: "all",
  GROUPED: "grouped",
  HISTORY: "history",
};

const AppsSidebar = memo(function AppsSidebar({
  view,
  onViewChange,
  runners,
  selectedRunners,
  onSelectedRunnersChange,
  totalOps,
  updatesCount = 0,
  onAddRunner,
  onManageRunners,
}) {
  const handleRunnerToggle = (runnerId, checked) => {
    onSelectedRunnersChange((prev) => {
      if (checked) {
        const next = new Set(prev);
        next.add(runnerId);
        // If all runners are now in the set, clear it to mean "show all" (no filter)
        if (runners.every((r) => next.has(r.id))) return new Set();
        return next;
      } else {
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
          className={`${styles.sidebarItem} ${styles.updatesItem} ${view === APPS_VIEWS.UPDATES ? styles.active : ""}`}
          onClick={() => onViewChange(APPS_VIEWS.UPDATES)}
        >
          <ArrowUpCircle size={16} className={styles.sidebarItemIcon} />
          <span className={styles.sidebarItemName}>Updates</span>
          {updatesCount > 0 && <span className={styles.updatesBadge}>{updatesCount}</span>}
        </button>
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
        <button
          className={`${styles.sidebarItem} ${view === APPS_VIEWS.HISTORY ? styles.active : ""}`}
          onClick={() => onViewChange(APPS_VIEWS.HISTORY)}
        >
          <History size={16} className={styles.sidebarItemIcon} />
          <span className={styles.sidebarItemName}>History</span>
        </button>
      </div>

      {/* Runner filter — checkboxes only shown when multiple runners */}
      {(runners.length > 1 || onAddRunner) && (
        <>
          <div className={styles.sidebarHeader}>
            <h3>Filter by Runner</h3>
          </div>
          <div className={styles.filterContainer}>
            {runners.length > 1 && (
              <div className={styles.filterBox}>
                {runners.map((runner) => {
                  const isChecked = selectedRunners.has(runner.id);
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
            )}

            {onAddRunner && (
              <button
                className={`${styles.sidebarItem} ${styles.addButton}`}
                onClick={onAddRunner}
                title="Add Runner"
                aria-label="Add Runner"
              >
                <Plus size={16} aria-hidden="true" />
                <span>+ Add Runner</span>
              </button>
            )}
          </div>
        </>
      )}

      {/* Manage section */}
      {onManageRunners && (
        <>
          <div className={`${styles.sidebarHeader} ${styles.manageSectionSpacing}`}>
            <h3>Manage</h3>
          </div>
          <div className={styles.filterContainer}>
            <button
              className={`${styles.sidebarItem} ${styles.manageButton}`}
              onClick={onManageRunners}
              title="Manage Runners"
              aria-label="Manage Runners"
            >
              <Settings size={16} aria-hidden="true" />
              <span>Runners</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
});

AppsSidebar.displayName = "AppsSidebar";

AppsSidebar.propTypes = {
  view: PropTypes.oneOf([APPS_VIEWS.UPDATES, APPS_VIEWS.ALL, APPS_VIEWS.GROUPED, APPS_VIEWS.HISTORY]).isRequired,
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
  updatesCount: PropTypes.number,
  onAddRunner: PropTypes.func,
  onManageRunners: PropTypes.func,
};

export default AppsSidebar;

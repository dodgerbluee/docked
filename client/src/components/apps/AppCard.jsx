/**
 * AppCard
 * Displays a single dockhand app with multiple named runnable operations.
 * Shows the app name, description, runner badge, version/update status,
 * inline operation buttons, and most-recent last-run footer.
 */

import React, { memo } from "react";
import PropTypes from "prop-types";
import { Loader, Clock, Server } from "lucide-react";
import styles from "./AppCard.module.css";

function hasVersionUpdate(current, latest) {
  if (!current || !latest) return false;
  return String(latest).replace(/^v/, "").trim() !== String(current).replace(/^v/, "").trim();
}

function formatAge(ts) {
  if (!ts) return null;
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function getMostRecentOp(operations) {
  return (
    operations
      .filter((op) => op.lastRun)
      .sort((a, b) => new Date(b.lastRun.startedAt) - new Date(a.lastRun.startedAt))[0] ?? null
  );
}

const AppCard = memo(function AppCard({ app, runner, onRun, showRunner = true }) {
  const mostRecent = getMostRecentOp(app.operations || []);
  const hasRun = !!mostRecent;
  const exitOk = hasRun && mostRecent.lastRun.exitCode === 0;

  const borderClass = !hasRun ? styles.neverRun : exitOk ? styles.exitOk : styles.exitFail;

  return (
    <div className={`${styles.card} ${borderClass}`}>
      <div className={styles.content}>
        {/* Header row: name + runner badge */}
        <div className={styles.header}>
          <span className={styles.name} title={app.name}>
            {app.name}
          </span>
          {showRunner && (
            <span className={styles.runnerBadge} title={runner.url}>
              <Server size={10} />
              {runner.name}
            </span>
          )}
        </div>

        {/* Description */}
        {app.description ? (
          <p className={styles.description}>{app.description}</p>
        ) : (
          <p className={styles.noDescription}>No description</p>
        )}

        {/* Version row */}
        {(app.currentVersion || app.versionSource || app.systemUpdatesAvailable) && (
          <div className={styles.versionRow}>
            <span
              className={`${styles.versionBadge} ${
                hasVersionUpdate(app.currentVersion, app.latestVersion)
                  ? styles.versionOutdated
                  : styles.versionCurrent
              }`}
              title={
                hasVersionUpdate(app.currentVersion, app.latestVersion)
                  ? `Update available: ${app.latestVersion}`
                  : app.currentVersion
                  ? "Up to date"
                  : "Version tracking configured"
              }
            >
              {app.currentVersion ?? "unknown"}
              {hasVersionUpdate(app.currentVersion, app.latestVersion) && (
                <span className={styles.versionArrow}> → {app.latestVersion}</span>
              )}
            </span>
            {app.systemUpdatesAvailable && (
              <span className={styles.sysUpdateBadge} title="System package updates available">
                {app.systemUpdateCount > 0 ? `${app.systemUpdateCount} packages` : "System updates"}
              </span>
            )}
          </div>
        )}

        {/* Operations row — inline buttons */}
        {(app.operations || []).length > 0 && (
          <div className={styles.operationsRow}>
            {(app.operations || []).map((op) => (
              <button
                key={op.name}
                className={`${styles.opBtn} ${op.active ? styles.opBtnActive : ""}`}
                onClick={() => onRun(runner, app, op)}
                disabled={op.active}
                title={op.active ? `${op.label || op.name} is running…` : `Run ${op.label || op.name}`}
              >
                {op.active && <Loader size={10} className={styles.opBtnSpinner} />}
                {op.label || op.name}
              </button>
            ))}
          </div>
        )}

        {/* Footer: most-recent run across all ops */}
        <div className={styles.footer}>
          {hasRun ? (
            <span
              className={`${styles.lastRun} ${exitOk ? styles.lastRunOk : styles.lastRunFail}`}
              title={`Exit code: ${mostRecent.lastRun.exitCode}`}
            >
              <Clock size={11} />
              {mostRecent.label || mostRecent.name} · {formatAge(mostRecent.lastRun.startedAt)} · exit {mostRecent.lastRun.exitCode}
            </span>
          ) : (
            <span className={styles.neverRunLabel}>Never run</span>
          )}
        </div>
      </div>
    </div>
  );
});

AppCard.displayName = "AppCard";

AppCard.propTypes = {
  app: PropTypes.shape({
    name: PropTypes.string.isRequired,
    description: PropTypes.string,
    currentVersion: PropTypes.string,
    latestVersion: PropTypes.string,
    systemUpdatesAvailable: PropTypes.bool,
    systemUpdateCount: PropTypes.number,
    versionSource: PropTypes.shape({
      type: PropTypes.string,
      repo: PropTypes.string,
    }),
    operations: PropTypes.arrayOf(
      PropTypes.shape({
        name: PropTypes.string.isRequired,
        label: PropTypes.string,
        active: PropTypes.bool,
        lastRun: PropTypes.shape({
          exitCode: PropTypes.number,
          startedAt: PropTypes.string,
        }),
      })
    ),
  }).isRequired,
  runner: PropTypes.shape({
    id: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
    url: PropTypes.string,
  }).isRequired,
  onRun: PropTypes.func.isRequired,
  showRunner: PropTypes.bool,
};

export default AppCard;

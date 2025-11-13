import React from "react";
import PropTypes from "prop-types";
import styles from "./LogViewer.module.css";

/**
 * LogViewer Component
 * Displays logs for a selected batch run
 */
const LogViewer = React.memo(function LogViewer({ selectedRun }) {
  return (
    <div className={styles.logViewer}>
      <div className={styles.header}>
        <h4 className={styles.title}>
          {selectedRun
            ? `Run #${selectedRun.id} Logs`
            : "Select a run to view logs"}
        </h4>
      </div>
      <div className={styles.content}>
        {selectedRun && selectedRun.logs ? (
          <pre className={styles.logContent}>{selectedRun.logs}</pre>
        ) : selectedRun ? (
          <div className={styles.empty}>No logs available for this run</div>
        ) : (
          <div className={styles.empty}>
            Select a run from the history to view its logs
          </div>
        )}
      </div>
    </div>
  );
});

LogViewer.propTypes = {
  selectedRun: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    logs: PropTypes.string,
  }),
};

export default LogViewer;


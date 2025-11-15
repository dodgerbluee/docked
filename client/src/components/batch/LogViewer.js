import React, { useMemo } from "react";
import PropTypes from "prop-types";
import styles from "./LogViewer.module.css";

/**
 * LogViewer Component
 * Displays logs for a selected batch run with color-coded log levels
 */
const LogViewer = React.memo(function LogViewer({ selectedRun }) {
  const formattedLogs = useMemo(() => {
    if (!selectedRun || !selectedRun.logs) return null;

    // Split logs by lines and color-code only the log level text inside brackets
    const lines = selectedRun.logs.split('\n');
    return lines.map((line, index) => {
      // Match log level patterns in brackets: [INFO], [WARN], [ERROR], [DEBUG], etc. (case insensitive)
      // Pattern: [ followed by log level text, followed by ] - can appear anywhere in the line
      // Format is typically: [timestamp] [LEVEL] [jobType] message
      const bracketMatch = line.match(/(\[)(info|warn|warning|error|err|debug)(\])/i);
      
      if (bracketMatch) {
        const matchIndex = bracketMatch.index;
        const beforeMatch = line.substring(0, matchIndex);
        const [, openBracket, levelText, closeBracket] = bracketMatch;
        const afterMatch = line.substring(matchIndex + bracketMatch[0].length);
        
        // Determine which color class to use based on log level
        let levelClass = styles.logDefault;
        const lowerLevel = levelText.toLowerCase();
        if (lowerLevel === 'info') {
          levelClass = styles.logInfo;
        } else if (lowerLevel === 'warn' || lowerLevel === 'warning') {
          levelClass = styles.logWarn;
        } else if (lowerLevel === 'error' || lowerLevel === 'err') {
          levelClass = styles.logError;
        } else if (lowerLevel === 'debug') {
          levelClass = styles.logDebug;
        }
        
        return (
          <span key={index}>
            <span className={styles.logDefault}>{beforeMatch}</span>
            <span className={styles.logDefault}>{openBracket}</span>
            <span className={levelClass}>{levelText.toUpperCase()}</span>
            <span className={styles.logDefault}>{closeBracket}</span>
            <span className={styles.logDefault}>{afterMatch}</span>
            {index < lines.length - 1 && '\n'}
          </span>
        );
      }

      // No log level found, return line as-is
      return (
        <span key={index} className={styles.logDefault}>
          {line}
          {index < lines.length - 1 && '\n'}
        </span>
      );
    });
  }, [selectedRun?.logs]);

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
          <pre className={styles.logContent}>{formattedLogs}</pre>
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


/**
 * Component for displaying batch run logs/details
 */

import React from "react";

/**
 * Batch run details component
 * @param {Object} props
 * @param {Object|null} props.selectedRun - Currently selected run
 */
const BatchRunDetails = ({ selectedRun }) => {
  return (
    <div
      style={{
        flex: 1,
        padding: "15px",
        overflowY: "auto",
        maxHeight: "600px",
        fontFamily: "monospace",
        fontSize: "0.85rem",
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
      }}
    >
      {selectedRun && selectedRun.logs ? (
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "var(--text-primary)",
          }}
        >
          {selectedRun.logs}
        </pre>
      ) : selectedRun ? (
        <div style={{ color: "var(--text-secondary)" }}>No logs available for this run</div>
      ) : (
        <div style={{ color: "var(--text-secondary)" }}>
          Select a run from the history to view its logs
        </div>
      )}
    </div>
  );
};

export default BatchRunDetails;

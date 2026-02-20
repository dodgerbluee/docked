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
  const renderLogs = (logs) => {
    if (!logs) return null;

    const lines = logs.split("\n");
    return lines.map((line, index) => {
      if (!line) {
        return (
          <div key={index} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {"\u00A0"}
          </div>
        );
      }

      // Parse log line format: [timestamp] [LEVEL] [jobType] message metadata
      // Extract the message part (everything after the jobType)
      const logPattern = /^(\[[^\]]+\]\s+\[[^\]]+\]\s+\[[^\]]+\]\s+)(.+)$/;
      const match = line.match(logPattern);

      if (match) {
        const prefix = match[1]; // [timestamp] [LEVEL] [jobType]
        const message = match[2]; // message + metadata

        // Check if message contains upgrade messages (case-insensitive)
        const lowerMessage = message.toLowerCase();
        const isUpgradeLine =
          lowerMessage.includes("newly identified upgrade:") ||
          lowerMessage.includes("new tracked app update found:");

        return (
          <div
            key={index}
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            <span style={{ color: "var(--text-primary)" }}>{prefix}</span>
            <span style={{ color: isUpgradeLine ? "#4caf50" : "var(--text-primary)" }}>
              {message}
            </span>
          </div>
        );
      }

      // Fallback: if line doesn't match pattern, check whole line
      const lowerLine = line.toLowerCase();
      const isUpgradeLine =
        lowerLine.includes("newly identified upgrade:") ||
        lowerLine.includes("new tracked app update found:");

      return (
        <div
          key={index}
          style={{
            color: isUpgradeLine ? "#4caf50" : "var(--text-primary)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {line}
        </div>
      );
    });
  };

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
        <div
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            // Remove color inheritance to allow child divs to set their own colors
            color: "inherit",
          }}
        >
          {renderLogs(selectedRun.logs)}
        </div>
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

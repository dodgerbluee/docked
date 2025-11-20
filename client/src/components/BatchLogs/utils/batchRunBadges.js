/**
 * Badge components for batch runs
 */

import React from "react";

/**
 * Job type badge configuration
 */
const JOB_TYPES = {
  "docker-hub-pull": {
    bg: "rgba(0, 90, 156, 0.2)",
    color: "var(--dodger-blue)",
    text: "Docker Hub Scan",
  },
  "tracked-apps-check": {
    bg: "rgba(139, 92, 246, 0.2)",
    color: "#8b5cf6",
    text: "Tracked Apps Scan",
  },
};

/**
 * Status badge configuration
 */
const STATUS_COLORS = {
  running: {
    bg: "rgba(0, 90, 156, 0.2)",
    color: "var(--dodger-blue)",
    text: "Running",
  },
  completed: {
    bg: "rgba(34, 197, 94, 0.2)",
    color: "#22c55e",
    text: "Completed",
  },
  failed: {
    bg: "rgba(239, 62, 66, 0.2)",
    color: "var(--dodger-red)",
    text: "Failed",
  },
};

/**
 * Badge component base styles
 */
const badgeBaseStyle = {
  display: "inline-block",
  padding: "4px 12px",
  borderRadius: "12px",
  fontSize: "0.85rem",
  fontWeight: "600",
};

/**
 * Get job type badge JSX
 * @param {string} jobType - Job type identifier
 * @returns {JSX.Element} Job type badge
 */
export const getJobTypeBadge = (jobType) => {
  const jobInfo = JOB_TYPES[jobType] || {
    bg: "rgba(156, 163, 175, 0.2)",
    color: "#9ca3af",
    text: jobType || "Unknown Job",
  };
  return (
    <span
      style={{
        ...badgeBaseStyle,
        background: jobInfo.bg,
        color: jobInfo.color,
      }}
    >
      {jobInfo.text}
    </span>
  );
};

/**
 * Get status badge JSX
 * @param {string} status - Run status
 * @returns {JSX.Element} Status badge
 */
export const getStatusBadge = (status) => {
  const style = STATUS_COLORS[status] || STATUS_COLORS.running;

  return (
    <span
      style={{
        ...badgeBaseStyle,
        background: style.bg,
        color: style.color,
      }}
    >
      {style.text}
    </span>
  );
};

/**
 * Get manual badge JSX (icon only with tooltip)
 * @returns {JSX.Element} Manual badge
 */
export const getManualBadge = () => {
  return (
    <span
      title="Manual"
      style={{
        ...badgeBaseStyle,
        background: "rgba(239, 62, 66, 0.2)",
        color: "var(--dodger-red)",
        padding: "4px 8px",
        cursor: "help",
      }}
    >
      👤
    </span>
  );
};

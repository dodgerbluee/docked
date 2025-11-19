/**
 * Component for displaying scheduled run information and trigger controls
 */

import React, { useState } from "react";
import { getJobTypeBadge } from "../utils/batchRunBadges";
import { formatNextRun, formatInterval } from "../utils/batchRunFormatters";

/**
 * Scheduled run display component
 * @param {Object} props
 * @param {Object} props.config - Batch config for the job type
 * @param {Date|null} props.nextScheduledRun - Next scheduled run time
 * @param {Function} props.onTrigger - Callback when "Run Now" is clicked
 * @param {string} props.jobType - Job type identifier
 * @param {string} props.buttonClassName - Additional CSS class for the button
 */
const ScheduledRunDisplay = ({
  config,
  nextScheduledRun,
  onTrigger,
  jobType,
  buttonClassName = "",
}) => {
  const [triggering, setTriggering] = useState(false);

  if (!config?.enabled) {
    return null;
  }

  const handleTrigger = async () => {
    if (onTrigger) {
      setTriggering(true);
      try {
        await onTrigger();
      } catch (err) {
        console.error(`Error triggering ${jobType} batch:`, err);
      } finally {
        setTriggering(false);
      }
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "200px 1fr",
        gap: "15px",
        alignItems: "center",
        padding: "12px",
        background: "var(--bg-tertiary)",
        borderRadius: "6px",
      }}
    >
      <div style={{ fontWeight: "600", color: "var(--text-primary)" }}>
        {getJobTypeBadge(jobType)}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              color: "var(--text-primary)",
              fontWeight: "500",
            }}
          >
            {formatNextRun(nextScheduledRun)}
          </span>
          <span
            style={{
              fontSize: "0.85rem",
              color: "var(--text-secondary)",
            }}
          >
            (Interval: {formatInterval(config.intervalMinutes)})
          </span>
        </div>
        <button
          onClick={handleTrigger}
          disabled={triggering}
          className={`update-button ${buttonClassName}`}
          style={{
            padding: "8px 16px",
            fontSize: "0.9rem",
            fontWeight: "600",
            background:
              jobType === "docker-hub-pull" ? "rgba(30, 144, 255, 0.2)" : "rgba(139, 92, 246, 0.2)",
            color: jobType === "docker-hub-pull" ? "var(--dodger-blue)" : "#8b5cf6",
            border:
              jobType === "docker-hub-pull" ? "1px solid var(--dodger-blue)" : "1px solid #8b5cf6",
            borderRadius: "8px",
            cursor: triggering ? "not-allowed" : "pointer",
            transition: "all 0.3s",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            marginTop: 0,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          {triggering ? "Running..." : "Run Now"}
        </button>
      </div>
    </div>
  );
};

export default ScheduledRunDisplay;

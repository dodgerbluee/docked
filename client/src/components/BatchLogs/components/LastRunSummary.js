/**
 * Component for displaying the last run summary table
 */

import React from "react";
import { getJobTypeBadge, getStatusBadge } from "../utils/batchRunBadges";
import { formatDate, formatDuration } from "../utils/batchRunFormatters";

/**
 * Last run summary component
 * @param {Object} props
 * @param {Object} props.latestRunsByJobType - Latest runs by job type
 */
const LastRunSummary = ({ latestRunsByJobType }) => {
  const hasRuns =
    latestRunsByJobType["docker-hub-pull"] ||
    latestRunsByJobType["tracked-apps-check"];

  if (!hasRuns) {
    return null;
  }

  return (
    <div
      style={{
        background: "var(--bg-secondary)",
        padding: "20px",
        paddingBottom: "30px",
        borderRadius: "8px",
        marginBottom: "30px",
        border: "1px solid var(--border-color)",
      }}
    >
      <h3
        style={{
          marginTop: 0,
          color: "var(--text-primary)",
          marginBottom: "20px",
        }}
      >
        Last Run
      </h3>
      <div
        style={{
          display: "table",
          width: "100%",
          borderCollapse: "separate",
          borderSpacing: "0",
        }}
      >
        {/* Table Header */}
        <div
          style={{
            display: "table-row",
            background: "var(--bg-tertiary)",
          }}
        >
          <div
            style={{
              display: "table-cell",
              padding: "12px",
              fontWeight: "600",
              color: "var(--text-primary)",
              borderBottom: "1px solid var(--border-color)",
            }}
          >
            Job Type
          </div>
          <div
            style={{
              display: "table-cell",
              padding: "12px",
              fontWeight: "600",
              color: "var(--text-primary)",
              borderBottom: "1px solid var(--border-color)",
            }}
          >
            Status
          </div>
          <div
            style={{
              display: "table-cell",
              padding: "12px",
              fontWeight: "600",
              color: "var(--text-primary)",
              borderBottom: "1px solid var(--border-color)",
            }}
          >
            Start Time
          </div>
          <div
            style={{
              display: "table-cell",
              padding: "12px",
              fontWeight: "600",
              color: "var(--text-primary)",
              borderBottom: "1px solid var(--border-color)",
            }}
          >
            Completed Time
          </div>
          <div
            style={{
              display: "table-cell",
              padding: "12px",
              fontWeight: "600",
              color: "var(--text-primary)",
              borderBottom: "1px solid var(--border-color)",
            }}
          >
            Duration
          </div>
          <div
            style={{
              display: "table-cell",
              padding: "12px",
              fontWeight: "600",
              color: "var(--text-primary)",
              borderBottom: "1px solid var(--border-color)",
            }}
          >
            Details
          </div>
        </div>
        {/* Table Rows - One for each job type */}
        {latestRunsByJobType["docker-hub-pull"] && (
          <div style={{ display: "table-row" }}>
            <div
              style={{
                display: "table-cell",
                padding: "12px",
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              {getJobTypeBadge("docker-hub-pull")}
            </div>
            <div
              style={{
                display: "table-cell",
                padding: "12px",
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              {getStatusBadge(latestRunsByJobType["docker-hub-pull"].status)}
            </div>
            <div
              style={{
                display: "table-cell",
                padding: "12px",
                color: "var(--text-primary)",
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              {formatDate(latestRunsByJobType["docker-hub-pull"].started_at)}
            </div>
            <div
              style={{
                display: "table-cell",
                padding: "12px",
                color: "var(--text-primary)",
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              {latestRunsByJobType["docker-hub-pull"].completed_at
                ? formatDate(latestRunsByJobType["docker-hub-pull"].completed_at)
                : "N/A"}
            </div>
            <div
              style={{
                display: "table-cell",
                padding: "12px",
                color: "var(--text-primary)",
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              {latestRunsByJobType["docker-hub-pull"].duration_ms
                ? formatDuration(latestRunsByJobType["docker-hub-pull"].duration_ms)
                : "N/A"}
            </div>
            <div
              style={{
                display: "table-cell",
                padding: "12px",
                color: "var(--text-primary)",
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              <div style={{ marginBottom: "4px" }}>
                {latestRunsByJobType["docker-hub-pull"].containers_checked || 0} containers checked
              </div>
              <div>
                {latestRunsByJobType["docker-hub-pull"].containers_updated || 0} updates found
              </div>
            </div>
          </div>
        )}
        {latestRunsByJobType["tracked-apps-check"] && (
          <div style={{ display: "table-row" }}>
            <div
              style={{
                display: "table-cell",
                padding: "12px",
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              {getJobTypeBadge("tracked-apps-check")}
            </div>
            <div
              style={{
                display: "table-cell",
                padding: "12px",
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              {getStatusBadge(latestRunsByJobType["tracked-apps-check"].status)}
            </div>
            <div
              style={{
                display: "table-cell",
                padding: "12px",
                color: "var(--text-primary)",
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              {formatDate(latestRunsByJobType["tracked-apps-check"].started_at)}
            </div>
            <div
              style={{
                display: "table-cell",
                padding: "12px",
                color: "var(--text-primary)",
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              {latestRunsByJobType["tracked-apps-check"].completed_at
                ? formatDate(latestRunsByJobType["tracked-apps-check"].completed_at)
                : "N/A"}
            </div>
            <div
              style={{
                display: "table-cell",
                padding: "12px",
                color: "var(--text-primary)",
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              {latestRunsByJobType["tracked-apps-check"].duration_ms
                ? formatDuration(latestRunsByJobType["tracked-apps-check"].duration_ms)
                : "N/A"}
            </div>
            <div
              style={{
                display: "table-cell",
                padding: "12px",
                color: "var(--text-primary)",
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              <div style={{ marginBottom: "4px" }}>
                {latestRunsByJobType["tracked-apps-check"].containers_checked || 0} apps checked
              </div>
              <div>
                {latestRunsByJobType["tracked-apps-check"].containers_updated || 0} updates found
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Error messages for each job type */}
      {latestRunsByJobType["docker-hub-pull"]?.error_message && (
        <div
          style={{
            marginTop: "15px",
            padding: "12px",
            background: "rgba(239, 62, 66, 0.1)",
            border: "1px solid var(--dodger-red)",
            borderRadius: "6px",
            color: "var(--dodger-red)",
          }}
        >
          <strong>Docker Hub Scan Error:</strong>{" "}
          {latestRunsByJobType["docker-hub-pull"].error_message}
        </div>
      )}
      {latestRunsByJobType["tracked-apps-check"]?.error_message && (
        <div
          style={{
            marginTop: "15px",
            padding: "12px",
            background: "rgba(239, 62, 66, 0.1)",
            border: "1px solid var(--dodger-red)",
            borderRadius: "6px",
            color: "var(--dodger-red)",
          }}
        >
          <strong>Tracked Apps Scan Error:</strong>{" "}
          {latestRunsByJobType["tracked-apps-check"].error_message}
        </div>
      )}
    </div>
  );
};

export default LastRunSummary;


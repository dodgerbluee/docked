/**
 * Component for displaying the batch run history list
 */

import React from "react";
import { getJobTypeBadge, getStatusBadge, getManualBadge } from "../utils/batchRunBadges";
import { formatDate } from "../utils/batchRunFormatters";

/**
 * Batch run list component
 * @param {Object} props
 * @param {Array} props.recentRuns - Array of recent batch runs
 * @param {Object|null} props.selectedRun - Currently selected run
 * @param {Function} props.onSelectRun - Callback when a run is selected
 */
const BatchRunList = ({ recentRuns, selectedRun, onSelectRun }) => {
  if (recentRuns.length === 0) {
    return (
      <div
        style={{
          padding: "20px",
          textAlign: "center",
          color: "var(--text-secondary)",
        }}
      >
        No batch runs yet
      </div>
    );
  }

  return (
    <>
      {recentRuns.map((run) => (
        <div
          key={run.id}
          onClick={() => onSelectRun(run)}
          style={{
            padding: "12px 15px",
            borderBottom: "1px solid var(--border-color)",
            cursor: "pointer",
            background: selectedRun?.id === run.id ? "var(--bg-tertiary)" : "transparent",
            transition: "background 0.2s",
          }}
          onMouseEnter={(e) => {
            if (selectedRun?.id !== run.id) {
              e.currentTarget.style.background = "var(--bg-tertiary)";
            }
          }}
          onMouseLeave={(e) => {
            if (selectedRun?.id !== run.id) {
              e.currentTarget.style.background = "transparent";
            }
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "5px",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontWeight: "600",
                  color: "var(--text-primary)",
                }}
              >
                Run #{run.id}
              </span>
              {getJobTypeBadge(run.job_type)}
              {getStatusBadge(run.status)}
              {Number(run.is_manual) === 1 && getManualBadge()}
            </div>
          </div>
          <div
            style={{
              fontSize: "0.8rem",
              color: "var(--text-secondary)",
            }}
          >
            {formatDate(run.started_at)}
          </div>
          {run.containers_checked !== null && (
            <div
              style={{
                fontSize: "0.8rem",
                color: "var(--text-tertiary)",
                marginTop: "3px",
              }}
            >
              {run.job_type === "tracked-apps-check"
                ? `${run.containers_checked} apps, ${run.containers_updated || 0} updates`
                : `${run.containers_checked} containers, ${run.containers_updated || 0} updates`}
            </div>
          )}
        </div>
      ))}
    </>
  );
};

export default BatchRunList;

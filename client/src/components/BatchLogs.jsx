/**
 * Batch Logs Component
 * Displays batch processing logs and run history
 */

import React, { useState, useContext, useMemo } from "react";
import "./Settings.css";
import { BatchConfigContext } from "../contexts/BatchConfigContext";
import { useBatchRuns } from "./BatchLogs/hooks/useBatchRuns";
import { useScheduledRunCalculation } from "./BatchLogs/hooks/useScheduledRunCalculation";
import ScheduledRunDisplay from "./BatchLogs/components/ScheduledRunDisplay";
import LastRunSummary from "./BatchLogs/components/LastRunSummary";
import BatchRunList from "./BatchLogs/components/BatchRunList";
import BatchRunDetails from "./BatchLogs/components/BatchRunDetails";

function BatchLogs({
  onNavigateHome = null,
  onTriggerBatch = null,
  onTriggerTrackedAppsBatch = null,
}) {
  // Get batchConfigs from Context - this will automatically update when state changes
  const contextValue = useContext(BatchConfigContext);
  const batchConfigs = useMemo(() => contextValue?.batchConfig || {}, [contextValue?.batchConfig]);

  // Check if any job type is enabled
  const hasEnabledJobs =
    batchConfigs["docker-hub-pull"]?.enabled ||
    false ||
    batchConfigs["tracked-apps-check"]?.enabled ||
    false;

  const [selectedRun, setSelectedRun] = useState(null);

  // Fetch batch runs using custom hook
  const {
    latestRun,
    latestRunsByJobType,
    recentRuns,
    loading,
    error,
    fetchLatestRun,
    fetchRecentRuns,
  } = useBatchRuns();

  // Calculate next scheduled runs using custom hooks
  const nextScheduledRunDockerHub = useScheduledRunCalculation(
    batchConfigs["docker-hub-pull"],
    recentRuns,
    "docker-hub-pull"
  );
  const nextScheduledRunTrackedApps = useScheduledRunCalculation(
    batchConfigs["tracked-apps-check"],
    recentRuns,
    "tracked-apps-check"
  );

  // Auto-select latest run if none selected
  React.useEffect(() => {
    if (!selectedRun && latestRun) {
      setSelectedRun(latestRun);
    }
  }, [latestRun, selectedRun]);

  // Handler for triggering batch runs with refresh
  const handleTriggerBatch = async () => {
    if (onTriggerBatch) {
      await onTriggerBatch();
      // Refresh the runs after triggering
      setTimeout(() => {
        fetchLatestRun();
        fetchRecentRuns();
      }, 1000);
    }
  };

  const handleTriggerTrackedAppsBatch = async () => {
    if (onTriggerTrackedAppsBatch) {
      await onTriggerTrackedAppsBatch();
      // Refresh the runs after triggering
      setTimeout(() => {
        fetchLatestRun();
        fetchRecentRuns();
      }, 1000);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-container">
        {error && (
          <div className="error-message" style={{ marginBottom: "20px" }}>
            {error}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: "40px" }}>
            <p style={{ color: "var(--text-secondary)" }}>Loading batch logs...</p>
          </div>
        )}

        {/* Next Scheduled Run */}
        <div
          style={{
            background: "var(--bg-secondary)",
            padding: "20px",
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
            Batch Jobs
          </h3>
          {hasEnabledJobs ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <ScheduledRunDisplay
                config={batchConfigs["docker-hub-pull"]}
                nextScheduledRun={nextScheduledRunDockerHub}
                onTrigger={handleTriggerBatch}
                jobType="docker-hub-pull"
              />
              <ScheduledRunDisplay
                config={batchConfigs["tracked-apps-check"]}
                nextScheduledRun={nextScheduledRunTrackedApps}
                onTrigger={handleTriggerTrackedAppsBatch}
                jobType="tracked-apps-check"
                buttonClassName="purple-button"
              />
            </div>
          ) : (
            <div
              style={{
                padding: "20px",
                textAlign: "center",
                color: "var(--text-secondary)",
              }}
            >
              No batch jobs are currently scheduled. Enable batch processing in Settings to schedule
              automatic runs.
            </div>
          )}
        </div>

        {/* Latest Run Summary - Show last run for each job type */}
        <LastRunSummary latestRunsByJobType={latestRunsByJobType} />

        {/* Run History and Logs */}
        {!loading && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "300px 1fr",
              gap: "20px",
            }}
          >
            {/* Run History List */}
            <div
              style={{
                background: "var(--bg-secondary)",
                borderRadius: "8px",
                border: "1px solid var(--border-color)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "15px",
                  borderBottom: "1px solid var(--border-color)",
                  background: "var(--bg-tertiary)",
                }}
              >
                <h4 style={{ margin: 0, color: "var(--text-primary)" }}>Run History</h4>
              </div>
              <div style={{ maxHeight: "600px", overflowY: "auto" }}>
                <BatchRunList
                  recentRuns={recentRuns}
                  selectedRun={selectedRun}
                  onSelectRun={setSelectedRun}
                />
              </div>
            </div>

            {/* Logs Display */}
            <div
              style={{
                background: "var(--bg-secondary)",
                borderRadius: "8px",
                border: "1px solid var(--border-color)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  padding: "15px",
                  borderBottom: "1px solid var(--border-color)",
                  background: "var(--bg-tertiary)",
                }}
              >
                <h4 style={{ margin: 0, color: "var(--text-primary)" }}>
                  {selectedRun ? `Run #${selectedRun.id} Logs` : "Select a run to view logs"}
                </h4>
              </div>
              <BatchRunDetails selectedRun={selectedRun} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default BatchLogs;

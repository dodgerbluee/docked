import { graphqlClient } from "./client";
import { PULL_CONTAINERS_MUTATION, BATCH_RUNS_QUERY } from "./queries";
import { mapGraphRunToRow } from "../hooks/batchRunsCache";

const SYNC_POLL_INTERVAL_MS = 1000;
const SYNC_MAX_WAIT_MS = 300000;

/**
 * Trigger the container sync in the Go API and wait for its batch run to
 * finish. The pullContainers mutation registers a 'running' docker-hub-pull
 * batch run before it responds, so the poll below always observes the new run.
 * Resolves with the terminal run row; rejects when the run fails or the wait
 * times out.
 */
export async function runContainerSync() {
  const trigger = await graphqlClient.mutation(PULL_CONTAINERS_MUTATION, {}).toPromise();
  if (trigger.error || !trigger.data?.pullContainers) {
    throw new Error(trigger.error?.message || "Failed to trigger container sync");
  }

  const startTime = Date.now();
  let batchRun = null;
  while (Date.now() - startTime < SYNC_MAX_WAIT_MS) {
    try {
      const runsResult = await graphqlClient
        .query(BATCH_RUNS_QUERY, { jobType: "DOCKER_HUB_PULL", first: 1 })
        .toPromise();
      batchRun = mapGraphRunToRow(runsResult.data?.batchRuns?.items?.[0]);
      if (batchRun && (batchRun.status === "completed" || batchRun.status === "failed")) {
        break;
      }
    } catch {
      // Continue polling on error
    }
    await new Promise((resolve) => setTimeout(resolve, SYNC_POLL_INTERVAL_MS));
  }

  if (!batchRun) {
    throw new Error("Batch job did not complete within the expected time");
  }
  if (batchRun.status === "failed") {
    throw new Error(batchRun.error_message || "Batch job failed");
  }
  return batchRun;
}

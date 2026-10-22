import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("../../graphql/client", () => ({
  graphqlClient: { query: (...args) => queryMock(...args) },
}));

import {
  fetchLatestRunsByJobType,
  clearBatchRunsCache,
  getCachedLatestRunsByJobType,
} from "../batchRunsCache";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function runsResult(username) {
  return {
    data: {
      batchRuns: {
        items: [
          {
            id: "1",
            jobType: "SCAN_FOR_UPDATES",
            status: "SUCCESS",
            queuedAt: null,
            startedAt: null,
            completedAt: null,
            durationMs: null,
            containersChecked: null,
            containersUpdated: null,
            errorMessage: username,
            logs: null,
            isManual: false,
          },
        ],
      },
    },
  };
}

describe("batchRunsCache session generation", () => {
  beforeEach(() => {
    queryMock.mockReset();
    clearBatchRunsCache();
  });

  it("drops results that complete after a logout cleared the cache", async () => {
    const d = deferred();
    queryMock.mockReturnValue({ toPromise: () => d.promise });

    const inflight = fetchLatestRunsByJobType();
    clearBatchRunsCache(); // logout while the request is in flight

    d.resolve(runsResult("alice")); // old user's response lands late
    await inflight;

    expect(getCachedLatestRunsByJobType()).toBeNull();
  });

  it("still caches results for the session that issued the request", async () => {
    const d = deferred();
    queryMock.mockReturnValue({ toPromise: () => d.promise });

    const inflight = fetchLatestRunsByJobType();
    d.resolve(runsResult("bob"));
    const runs = await inflight;

    expect(runs["scan-for-updates"].error_message).toBe("bob");
    expect(getCachedLatestRunsByJobType()["scan-for-updates"].error_message).toBe("bob");
  });

  it("a stale completion does not clear the newer session's in-flight request", async () => {
    const stale = deferred();
    queryMock.mockReturnValue({ toPromise: () => stale.promise });
    const first = fetchLatestRunsByJobType();
    clearBatchRunsCache();

    const fresh = deferred();
    queryMock.mockReturnValue({ toPromise: () => fresh.promise });
    const second = fetchLatestRunsByJobType();

    stale.resolve(runsResult("alice"));
    await first;

    // The new session's in-flight promise must still be deduplicated.
    expect(fetchLatestRunsByJobType()).toBe(second);

    fresh.resolve(runsResult("carol"));
    await second;
    expect(getCachedLatestRunsByJobType()["scan-for-updates"].error_message).toBe("carol");
  });
});

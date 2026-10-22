import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  vi.stubGlobal("matchMedia", (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
});

const queryMock = vi.fn();
vi.mock("../../graphql/client", () => ({
  graphqlClient: { query: (...args) => queryMock(...args) },
}));

const axiosGet = vi.fn();
vi.mock("axios", () => ({
  default: {
    get: (...args) => axiosGet(...args),
    defaults: { headers: { common: {} } },
  },
}));

vi.mock("../../hooks/useOperationTasks", () => ({
  useOperationTasks: () => ({
    tasks: [],
    startTask: vi.fn(),
    runningKeys: new Set(),
    dismissTask: vi.fn(),
    dismissAll: vi.fn(),
  }),
}));

// Heavy presentational children are irrelevant to the leak under test.
// AppCard stays real: it renders the runner name badge, which is exactly
// the private data that must not leak into the next session.
vi.mock("../../components/apps/AppsHistoryTab", () => ({ default: () => null }));
vi.mock("../../components/apps/AppsSidebar", () => ({
  default: () => null,
  APPS_VIEWS: { ALL: "all", UPDATES: "updates", HISTORY: "history" },
}));
vi.mock("../../components/ui/OperationTasksModal", () => ({ default: () => null }));
vi.mock("../../components/ui/OperationTasksDock", () => ({ default: () => null }));
vi.mock("../../components/ui/MobileDrawer", () => ({ default: ({ children }) => children }));

import AppsPage from "../AppsPage";
import { clearAllCaches } from "../../utils/cacheRegistry";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("AppsPage session guard", () => {
  it("drops a runners response that lands after logout", async () => {
    const dA = deferred();
    queryMock.mockReturnValue({ toPromise: () => dA.promise });
    // An app with a pending update so a leaked cache would actually render
    // in the default UPDATES view.
    axiosGet.mockReturnValue(
      Promise.resolve({
        data: { apps: [{ name: "leaked-app", currentVersion: "1.0.0", latestVersion: "2.0.0" }] },
      })
    );

    const { unmount } = render(<AppsPage />);
    await waitFor(() => expect(queryMock).toHaveBeenCalledTimes(1));

    // Logout: bump the session generation and clear module caches, then
    // navigate away (unmount) while A's runners request is still in flight.
    clearAllCaches();
    unmount();

    // A's response lands late — it must NOT repopulate the module cache.
    dA.resolve({
      data: {
        runners: [
          {
            id: 1,
            name: "secret-runner",
            url: "http://secret:9911",
            enabled: true,
            version: "1.0.0",
          },
        ],
      },
    });
    await new Promise((r) => setTimeout(r, 0));

    // New session mounts with its own request still pending.
    const dB = deferred();
    queryMock.mockReturnValue({ toPromise: () => dB.promise });
    render(<AppsPage />);
    await waitFor(() => expect(queryMock).toHaveBeenCalledTimes(2));

    // With the leak, B adopts A's cached runners: loading=false and the
    // "No apps found" runner-aware empty state renders. A clean session must
    // instead start from the loading skeleton with no inherited data.
    expect(document.body.innerHTML).toContain("skeleton");
    expect(screen.queryByText("secret-runner")).toBeNull();
    expect(screen.queryByText(/No apps found/)).toBeNull();
    expect(screen.queryByText("http://secret:9911")).toBeNull();

    dB.resolve({ data: { runners: [] } });
  });
});

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const hooksMock = vi.hoisted(() => ({
  fetchIntentPreview: vi.fn(),
  fetchExecutions: vi.fn(),
  fetchExecutionDetail: vi.fn(),
  executeIntent: vi.fn(),
  updateIntent: vi.fn(),
  deleteIntent: vi.fn(),
}));

vi.mock("../../../hooks/useIntents", () => ({
  useIntents: () => ({
    intents: [],
    loading: false,
    error: null,
    refetchIntents: vi.fn(),
    ...hooksMock,
  }),
}));

import IntentDetailModal from "../IntentDetailModal";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const INTENT_A = {
  id: "intent-a",
  name: "Alpha Intent",
  intent_type: "restart",
  match_criteria: {},
};
const INTENT_B = {
  id: "intent-b",
  name: "Beta Intent",
  intent_type: "restart",
  match_criteria: {},
};

beforeEach(() => {
  Object.values(hooksMock).forEach((fn) => fn.mockReset());
});

describe("IntentDetailModal identity guards", () => {
  it("drops a preview response for an intent that is no longer open", async () => {
    const previewA = deferred();
    hooksMock.fetchIntentPreview.mockReturnValueOnce(previewA.promise).mockResolvedValue({
      success: true,
      currentMatches: [{ containerName: "beta-live", imageName: "redis" }],
      excludedContainers: [],
    });
    hooksMock.fetchExecutions.mockResolvedValue({ success: true, executions: [] });

    const { rerender } = render(<IntentDetailModal isOpen intent={INTENT_A} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /Current Matches/i }));

    // The user moves on to another intent while A's preview is still in flight.
    rerender(<IntentDetailModal isOpen intent={INTENT_B} onClose={() => {}} />);
    // Opening a different intent resets the modal to its first tab, so the
    // user goes back to Matches for the new intent.
    fireEvent.click(screen.getByRole("tab", { name: /Current Matches/i }));

    await waitFor(() => expect(screen.getByText("beta-live")).toBeInTheDocument());

    // ...and A's preview lands now. It must not replace B's matches.
    previewA.resolve({
      success: true,
      currentMatches: [{ containerName: "alpha-stale", imageName: "nginx" }],
      excludedContainers: [],
    });
    await waitFor(() => expect(previewA.promise).resolves.toBeTruthy());

    expect(screen.queryByText("alpha-stale")).toBeNull();
    expect(screen.getByText("beta-live")).toBeInTheDocument();
  });

  it("keeps the live intent's preview when nothing changed", async () => {
    hooksMock.fetchIntentPreview.mockResolvedValue({
      success: true,
      currentMatches: [{ containerName: "alpha-live", imageName: "nginx" }],
      excludedContainers: [],
    });
    hooksMock.fetchExecutions.mockResolvedValue({ success: true, executions: [] });

    render(<IntentDetailModal isOpen intent={INTENT_A} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /Matches/i }));

    await waitFor(() => expect(screen.getByText("alpha-live")).toBeInTheDocument());
  });

  it("drops an execution detail response after the intent is swapped out", async () => {
    const detail10 = deferred();
    hooksMock.fetchIntentPreview.mockResolvedValue({
      success: true,
      currentMatches: [],
      excludedContainers: [],
    });
    hooksMock.fetchExecutions
      .mockResolvedValueOnce({
        success: true,
        executions: [
          {
            id: "10",
            status: "completed",
            triggerType: "manual",
            startedAt: "2026-10-01T10:00:00Z",
            containersMatched: 1,
          },
        ],
      })
      .mockResolvedValue({
        success: true,
        executions: [
          {
            id: "30",
            status: "completed",
            triggerType: "manual",
            startedAt: "2026-10-03T10:00:00Z",
            containersMatched: 3,
          },
        ],
      });
    hooksMock.fetchExecutionDetail.mockReturnValue(detail10.promise);

    const { rerender } = render(<IntentDetailModal isOpen intent={INTENT_A} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /History/i }));
    await waitFor(() => expect(screen.getByText("1 matched")).toBeInTheDocument());

    // User opens execution 10, then the parent moves to a different intent.
    fireEvent.click(screen.getByText("1 matched").closest("button"));
    rerender(<IntentDetailModal isOpen intent={INTENT_B} onClose={() => {}} />);
    // The intent swap resets the modal to its first tab, so the user opens
    // History again for the new intent.
    fireEvent.click(screen.getByRole("tab", { name: /History/i }));

    await waitFor(() => expect(screen.getByText("3 matched")).toBeInTheDocument());

    // The stale detail for the old intent's execution lands now.
    detail10.resolve({
      success: true,
      execution: {
        id: "10",
        status: "failed",
        triggerType: "manual",
        startedAt: "2026-10-01T10:00:00Z",
        containersMatched: 1,
        errorMessage: "stale-detail-for-execution-10",
      },
      containers: [
        { id: "c1", containerName: "exec10-stale", status: "failed", imageName: "nginx" },
      ],
    });
    await waitFor(() => expect(detail10.promise).resolves.toBeTruthy());

    expect(screen.queryByText("exec10-stale")).toBeNull();
    expect(screen.queryByText("stale-detail-for-execution-10")).toBeNull();
    expect(screen.getByText("3 matched")).toBeInTheDocument();
  });

  it("drops an execution detail response after going back and opening another execution", async () => {
    const detail10 = deferred();
    hooksMock.fetchIntentPreview.mockResolvedValue({
      success: true,
      currentMatches: [],
      excludedContainers: [],
    });
    hooksMock.fetchExecutions.mockResolvedValue({
      success: true,
      executions: [
        {
          id: "10",
          status: "completed",
          triggerType: "manual",
          startedAt: "2026-10-01T10:00:00Z",
          containersMatched: 1,
        },
        {
          id: "20",
          status: "completed",
          triggerType: "manual",
          startedAt: "2026-10-02T10:00:00Z",
          containersMatched: 2,
        },
      ],
    });
    hooksMock.fetchExecutionDetail.mockReturnValueOnce(detail10.promise).mockResolvedValue({
      success: true,
      execution: {
        id: "20",
        status: "completed",
        triggerType: "manual",
        startedAt: "2026-10-02T10:00:00Z",
        containersMatched: 2,
      },
      containers: [
        { id: "c2", containerName: "exec20-container", status: "upgraded", imageName: "redis" },
      ],
    });

    render(<IntentDetailModal isOpen intent={INTENT_A} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /History/i }));
    await waitFor(() => expect(screen.getByText("1 matched")).toBeInTheDocument());

    fireEvent.click(screen.getByText("1 matched").closest("button"));
    fireEvent.click(screen.getByRole("button", { name: /Back to History/i }));
    fireEvent.click(screen.getByText("2 matched").closest("button"));

    await waitFor(() => expect(screen.getByText("exec20-container")).toBeInTheDocument());

    detail10.resolve({
      success: true,
      execution: {
        id: "10",
        status: "failed",
        triggerType: "manual",
        startedAt: "2026-10-01T10:00:00Z",
        containersMatched: 1,
        errorMessage: "stale-detail-for-execution-10",
      },
      containers: [
        { id: "c1", containerName: "exec10-stale", status: "failed", imageName: "nginx" },
      ],
    });
    await waitFor(() => expect(detail10.promise).resolves.toBeTruthy());

    expect(screen.queryByText("exec10-stale")).toBeNull();
    expect(screen.getByText("exec20-container")).toBeInTheDocument();
  });
});

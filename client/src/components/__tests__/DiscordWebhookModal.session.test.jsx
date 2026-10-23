/**
 * Session-isolation regression tests for DiscordWebhookModal.
 *
 * handleSubmit awaits a webhook-info lookup and then creates/updates the
 * webhook through the CURRENT graphql client (it re-reads the token at call
 * time). Without a session guard, the URL typed by user A can be saved into
 * user B's account.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

beforeEach(() => {
  // The mocks are module-level, so clear them between tests: otherwise a later
  // test's toHaveBeenCalledTimes counts the previous test's calls.
  queryMock.mockReset();
  mutationMock.mockReset();
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});

const queryMock = vi.fn();
const mutationMock = vi.fn();
vi.mock("../../graphql/client", () => ({
  graphqlClient: {
    query: (...args) => queryMock(...args),
    mutation: (...args) => mutationMock(...args),
  },
}));

import DiscordWebhookModal from "../DiscordWebhookModal";
import { clearAllCaches } from "../../utils/cacheRegistry";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function op(promise) {
  return { toPromise: () => promise };
}

function openModal({ onClose, onSuccess }) {
  render(<DiscordWebhookModal isOpen onClose={onClose} onSuccess={onSuccess} />);
  const urlInput = document.getElementById("discordWebhookUrl");
  fireEvent.change(urlInput, {
    target: { name: "webhookUrl", value: "https://discord.com/api/webhooks/A/token" },
  });
  fireEvent.submit(document.querySelector("form"));
  return urlInput;
}

describe("DiscordWebhookModal session guard", () => {
  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  it("does not save the webhook when the session ended during the info lookup", async () => {
    const info = deferred();
    queryMock.mockReturnValue(op(info.promise));
    const createCall = vi.fn();
    mutationMock.mockImplementation(createCall);

    const onClose = vi.fn();
    const onSuccess = vi.fn();
    openModal({ onClose, onSuccess });

    // Logout + login of a different account while the lookup is in flight.
    act(() => {
      clearAllCaches();
    });

    await act(async () => {
      info.resolve({ data: { discordWebhookInfo: { name: "A's server" } } });
    });

    expect(createCall).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onSuccess when the session ended during the create mutation", async () => {
    queryMock.mockReturnValue(
      op(Promise.resolve({ data: { discordWebhookInfo: { name: "A's server" } } }))
    );
    const create = deferred();
    mutationMock.mockReturnValue(op(create.promise));

    const onClose = vi.fn();
    const onSuccess = vi.fn();
    openModal({ onClose, onSuccess });

    // Let the info lookup land so the create mutation is actually in flight.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mutationMock).toHaveBeenCalledTimes(1);

    act(() => {
      clearAllCaches();
    });

    await act(async () => {
      create.resolve({ data: { createDiscordWebhook: { id: "wh-1" } } });
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still creates the webhook for the live session (guard is not blanket)", async () => {
    queryMock.mockReturnValue(
      op(Promise.resolve({ data: { discordWebhookInfo: { name: "My server" } } }))
    );
    mutationMock.mockReturnValue(
      op(Promise.resolve({ data: { createDiscordWebhook: { id: "1" } } }))
    );

    const onClose = vi.fn();
    const onSuccess = vi.fn();
    openModal({ onClose, onSuccess });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mutationMock).toHaveBeenCalledTimes(1);
    const [doc, vars] = mutationMock.mock.calls[0];
    expect(String(doc)).toMatch(/createDiscordWebhook/);
    expect(vars.input.webhookUrl).toBe("https://discord.com/api/webhooks/A/token");
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/**
 * Session-isolation regression tests for useCredentialValidation.
 *
 * The discord step tests each webhook URL with a sequential chain of
 * mutations. Every mutation goes through the CURRENT graphql client, so a
 * session change partway through the chain must stop the remaining tests:
 * they would run with the new session's credentials.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mutationMock = vi.fn();
vi.mock("../../../../graphql/client", () => ({
  graphqlClient: {
    mutation: (...args) => mutationMock(...args),
  },
}));

import { useCredentialValidation } from "../useCredentialValidation";
import { clearAllCaches } from "../../../../utils/cacheRegistry";

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

function setup() {
  const currentUser = {
    username: "u1",
    discordWebhooks: [{ server_name: "one" }, { server_name: "two" }],
  };
  return renderHook(() =>
    useCredentialValidation({
      currentUser,
      currentStepType: "discord",
      userPasswords: { u1: "pw-123" },
      userCredentials: {
        u1: {
          discordWebhooks: [{ webhookUrl: "https://hook/1" }, { webhookUrl: "https://hook/2" }],
        },
      },
      userSkippedSteps: {},
      setUserStepErrors: vi.fn(),
      setError: vi.fn(),
      setLoading: vi.fn(),
    })
  );
}

describe("useCredentialValidation session guard", () => {
  beforeEach(() => {
    mutationMock.mockReset();
  });

  it("stops the webhook test chain after the session ends", async () => {
    const first = deferred();
    mutationMock.mockReturnValue(op(first.promise));

    const { result } = setup();

    let call;
    await act(async () => {
      call = result.current.validateCredentialsStep();
    });

    // Session ends while the first webhook test is in flight.
    act(() => {
      clearAllCaches();
    });

    let validation;
    await act(async () => {
      first.resolve({ data: { testDiscordWebhookUrl: { success: true } } });
      validation = await call;
    });

    expect(mutationMock).toHaveBeenCalledTimes(1);
    expect(validation.success).toBe(false);
  });

  it("still tests every webhook for the live session (guard is not blanket)", async () => {
    mutationMock.mockReturnValue(
      op(Promise.resolve({ data: { testDiscordWebhookUrl: { success: true } } }))
    );

    const { result } = setup();

    let validation;
    await act(async () => {
      validation = await result.current.validateCredentialsStep();
    });

    expect(mutationMock).toHaveBeenCalledTimes(2);
    expect(validation.success).toBe(true);
  });
});

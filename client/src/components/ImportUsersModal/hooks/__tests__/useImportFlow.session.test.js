/**
 * Session-isolation regression tests for useImportFlow.
 *
 * advanceFlow chains mutations in sequence (verify token → webhook tests →
 * create user). Each one runs on the CURRENT graphql/axios session, so when
 * an earlier step ends the session the later ones must not fire.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useImportFlow } from "../useImportFlow";
import { clearAllCaches } from "../../../../utils/cacheRegistry";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const usersData = { users: [{ username: "u1", instanceAdmin: true }] };

function setup(overrides = {}) {
  const props = {
    currentUser: usersData.users[0],
    currentStepType: "instance_admin_verification",
    currentStepIndex: 0,
    totalStepsForCurrentUser: 1,
    currentUserIndex: 0,
    totalUsers: 1,
    usersData,
    userSkippedSteps: {},
    verificationInputTokens: { u1: "token-from-logs" },
    handleVerifyToken: vi.fn().mockResolvedValue(true),
    validateCurrentStep: vi.fn().mockReturnValue(true),
    validateCredentialsStep: vi.fn().mockResolvedValue({ success: true }),
    createUserWithConfig: vi
      .fn()
      .mockResolvedValue({ success: true, imported: true, username: "u1" }),
    setLoading: vi.fn(),
    setError: vi.fn(),
    setUserStepErrors: vi.fn(),
    setUserSkippedSteps: vi.fn(),
    setCurrentStepIndex: vi.fn(),
    setCurrentUserIndex: vi.fn(),
    setUserCredentials: vi.fn(),
    importedUsers: [],
    importErrors: [],
    setImportErrors: vi.fn(),
    onSuccess: vi.fn(),
    ...overrides,
  };
  return { props, ...renderHook(() => useImportFlow(props)) };
}

describe("useImportFlow session guard", () => {
  it("does not create the user after the verify step ended the session", async () => {
    const verify = deferred();
    const { props, result } = setup({ handleVerifyToken: () => verify.promise });

    let run;
    await act(async () => {
      run = result.current.handleNext();
    });

    // Logout + login of a different account while the verify is in flight.
    act(() => {
      clearAllCaches();
    });

    let advanced;
    await act(async () => {
      verify.resolve(true);
      advanced = await run;
    });

    expect(props.createUserWithConfig).not.toHaveBeenCalled();
    expect(props.onSuccess).not.toHaveBeenCalled();
    expect(advanced).toBe(false);
  });

  it("still creates the user when the session is live (guard is not blanket)", async () => {
    const { props, result } = setup();

    let advanced;
    await act(async () => {
      advanced = await result.current.handleNext();
    });

    expect(props.createUserWithConfig).toHaveBeenCalledTimes(1);
    expect(props.onSuccess).toHaveBeenCalledTimes(1);
    expect(advanced).toBe(true);
  });

  it("does not create the user after the discord validation ended the session", async () => {
    const validation = deferred();
    const { props, result } = setup({
      currentStepType: "discord",
      verificationInputTokens: {},
      validateCredentialsStep: () => validation.promise,
    });

    let run;
    await act(async () => {
      run = result.current.handleNext();
    });

    act(() => {
      clearAllCaches();
    });

    let advanced;
    await act(async () => {
      validation.resolve({ success: true });
      advanced = await run;
    });

    expect(props.createUserWithConfig).not.toHaveBeenCalled();
    expect(advanced).toBe(false);
  });
});

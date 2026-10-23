/**
 * Session-isolation regression tests for useUserSettings.
 *
 * A successful username change hands back a NEW token that the caller
 * (useAuth.handleUsernameUpdate) installs into auth state, localStorage and
 * axios. A successful password change schedules a delayed auto-logout. Both
 * are async continuations that must not survive a session change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

beforeEach(() => {
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

import { useUserSettings } from "../useUserSettings";
import { clearAllCaches } from "../../utils/cacheRegistry";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// urql-shaped operation handle
function op(promise) {
  return { toPromise: () => promise };
}

const formEvent = () => ({ preventDefault: () => {} });

describe("useUserSettings session guards", () => {
  beforeEach(() => {
    queryMock.mockReturnValue(op(Promise.resolve({ data: { me: { username: "alice" } } })));
    mutationMock.mockReturnValue(op(Promise.resolve({ data: {} })));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not install a username-change token that lands after logout", async () => {
    const d = deferred();
    mutationMock.mockReturnValue(op(d.promise));

    const onUsernameUpdate = vi.fn();
    const { result } = renderHook(() => useUserSettings({ username: "alice", onUsernameUpdate }));

    act(() => {
      result.current.setNewUsername("bob");
      result.current.setUsernamePassword("pw");
    });

    let submit;
    act(() => {
      submit = result.current.handleUsernameSubmit(formEvent());
    });

    // Logout + login of a different account while the mutation is in flight.
    act(() => {
      clearAllCaches();
    });

    d.resolve({
      data: { updateUsername: { success: true, username: "bob", token: "TOKEN-OF-DEAD-SESSION" } },
    });
    await act(async () => {
      await submit;
    });

    expect(onUsernameUpdate).not.toHaveBeenCalled();
  });

  it("still installs the token for the live session (guard is not blanket)", async () => {
    mutationMock.mockReturnValue(
      op(
        Promise.resolve({
          data: { updateUsername: { success: true, username: "bob", token: "T" } },
        })
      )
    );

    const onUsernameUpdate = vi.fn();
    const { result } = renderHook(() => useUserSettings({ username: "alice", onUsernameUpdate }));

    act(() => {
      result.current.setNewUsername("bob");
      result.current.setUsernamePassword("pw");
    });

    await act(async () => {
      await result.current.handleUsernameSubmit(formEvent());
    });

    expect(onUsernameUpdate).toHaveBeenCalledWith("bob", "T");
  });

  it("does not let a dead session's password-change timer log out the new session", async () => {
    vi.useFakeTimers();

    mutationMock.mockReturnValue(
      op(Promise.resolve({ data: { updatePassword: { success: true } } }))
    );

    const onPasswordUpdateSuccess = vi.fn();
    const { result } = renderHook(() =>
      useUserSettings({ username: "alice", onPasswordUpdateSuccess })
    );

    act(() => {
      result.current.setCurrentPassword("old");
      result.current.setNewPassword("newpass");
      result.current.setConfirmPassword("newpass");
    });

    await act(async () => {
      await result.current.handlePasswordSubmit(formEvent());
    });

    // The user logs out and logs back in during the 1.5s grace period.
    act(() => {
      clearAllCaches(); // logout
      clearAllCaches(); // login
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onPasswordUpdateSuccess).not.toHaveBeenCalled();
  });

  it("still runs the auto-logout when the session is unchanged", async () => {
    vi.useFakeTimers();

    mutationMock.mockReturnValue(
      op(Promise.resolve({ data: { updatePassword: { success: true } } }))
    );

    const onPasswordUpdateSuccess = vi.fn();
    const { result } = renderHook(() =>
      useUserSettings({ username: "alice", onPasswordUpdateSuccess })
    );

    act(() => {
      result.current.setCurrentPassword("old");
      result.current.setNewPassword("newpass");
      result.current.setConfirmPassword("newpass");
    });

    await act(async () => {
      await result.current.handlePasswordSubmit(formEvent());
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onPasswordUpdateSuccess).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending auto-logout when the hook unmounts (session change)", async () => {
    vi.useFakeTimers();

    mutationMock.mockReturnValue(
      op(Promise.resolve({ data: { updatePassword: { success: true } } }))
    );

    const onPasswordUpdateSuccess = vi.fn();
    const { result, unmount } = renderHook(() =>
      useUserSettings({ username: "alice", onPasswordUpdateSuccess })
    );

    act(() => {
      result.current.setCurrentPassword("old");
      result.current.setNewPassword("newpass");
      result.current.setConfirmPassword("newpass");
    });

    await act(async () => {
      await result.current.handlePasswordSubmit(formEvent());
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onPasswordUpdateSuccess).not.toHaveBeenCalled();
  });
});

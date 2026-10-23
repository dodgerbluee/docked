/**
 * Session-isolation regression tests for useUserCreation's bootstrap login.
 *
 * When the wizard creates the first instance admin it logs in with the
 * credentials it just set and writes them straight into localStorage. That is
 * a real session transition: it must not happen for a session that died while
 * the request was in flight, and it must reset the graphql client + caches
 * the same way useAuth.handleLogin does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});

const createPostMock = vi.fn();
const loginPostMock = vi.fn();
vi.mock("axios", () => ({
  default: {
    post: (...args) => loginPostMock(...args),
    create: () => ({
      defaults: { headers: { common: {} } },
      post: (...args) => createPostMock(...args),
    }),
  },
}));

const resetClientMock = vi.fn();
vi.mock("../../../../graphql/client", () => ({
  resetGraphQLClient: () => resetClientMock(),
}));

import { useUserCreation } from "../useUserCreation";
import { clearAllCaches, getSessionGeneration } from "../../../../utils/cacheRegistry";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup() {
  const currentUser = { username: "owner", instanceAdmin: true };
  return renderHook(() =>
    useUserCreation({
      currentUser,
      userPasswords: { owner: "pw-123" },
      userCredentials: {},
      userSkippedSteps: {},
      verificationStatus: { owner: true },
      verificationInputTokens: {},
      setImporting: vi.fn(),
      setError: vi.fn(),
      setImportedUsers: vi.fn(),
      setImportErrors: vi.fn(),
      setVerificationTokens: vi.fn(),
    })
  );
}

describe("useUserCreation bootstrap login", () => {
  beforeEach(() => {
    resetClientMock.mockClear();
    loginPostMock.mockReset();
    createPostMock.mockReset();
  });

  it("does not install bootstrap credentials for a session that died mid-request", async () => {
    const d = deferred();
    createPostMock.mockReturnValue(d.promise);
    loginPostMock.mockResolvedValue({
      data: { success: true, token: "TOKEN-A", role: "Administrator" },
    });

    const { result } = setup();

    let run;
    act(() => {
      run = result.current.createUserWithConfig();
    });

    // Logout + login of a different account while the create is in flight.
    act(() => {
      clearAllCaches();
    });

    d.resolve({ data: { success: true } });
    await act(async () => {
      await run;
    });

    expect(localStorage.getItem("authToken")).toBeNull();
    expect(localStorage.getItem("userRole")).toBeNull();
    expect(resetClientMock).not.toHaveBeenCalled();
  });

  it("installs bootstrap credentials and mirrors handleLogin for the live session", async () => {
    createPostMock.mockResolvedValue({ data: { success: true } });
    loginPostMock.mockResolvedValue({
      data: { success: true, token: "TOKEN-A", role: "Administrator", instanceAdmin: true },
    });

    const genBefore = getSessionGeneration();
    const { result } = setup();

    await act(async () => {
      await result.current.createUserWithConfig();
    });

    expect(loginPostMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("authToken")).toBe("TOKEN-A");
    expect(localStorage.getItem("userRole")).toBe("Administrator");
    // Mirrors useAuth.handleLogin: fresh urql+graphql-ws pair and a fresh
    // cache generation before the credentials go in.
    expect(resetClientMock).toHaveBeenCalledTimes(1);
    expect(getSessionGeneration()).toBe(genBefore + 1);
  });

  it("does not bootstrap when a session already exists", async () => {
    localStorage.setItem("authToken", "EXISTING");
    createPostMock.mockResolvedValue({ data: { success: true } });

    const { result } = setup();
    await act(async () => {
      await result.current.createUserWithConfig();
    });

    expect(loginPostMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("authToken")).toBe("EXISTING");
  });
});

import { renderHook, act, waitFor } from "@testing-library/react";
import { getSessionGeneration, isSessionStale } from "../../utils/cacheRegistry";
import { showToast } from "../../utils/toast";

// Inline axios mock: useAuth needs get(), defaults.headers.common, a capturable
// response interceptor, and create() for the logout revocation client. (The
// shared __mocks__/axios.js is jest-based and unusable under vitest.)
const interceptors = vi.hoisted(() => ({ response: { use: vi.fn(), eject: vi.fn() } }));
const revokeCalls = vi.hoisted(() => []);
vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    defaults: { headers: { common: {} } },
    interceptors,
    create: vi.fn((createCfg) => ({
      post: vi.fn((url, body) => {
        revokeCalls.push({ url, body, createCfg });
        return Promise.resolve({ data: { message: "Logged out" } });
      }),
    })),
  },
}));

import { useAuth } from "../useAuth";

import axios from "axios";

function lastInterceptorErrorHandler() {
  const calls = interceptors.response.use.mock.calls;
  return calls[calls.length - 1][1];
}

function freshStorage() {
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  });
}

describe("useAuth session lifecycle", () => {
  beforeEach(() => {
    freshStorage();
    axios.get.mockReset();
    axios.get.mockResolvedValue({ data: {} });
    interceptors.response.use.mockReset();
    revokeCalls.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("handleLogin bumps sessionKey and cache generation so pre-login requests are stale", () => {
    const { result } = renderHook(() => useAuth());
    const genBefore = getSessionGeneration();
    const keyBefore = result.current.sessionKey;

    act(() => {
      result.current.handleLogin("tokenB", "bob", "Administrator", false);
    });

    expect(result.current.sessionKey).toBe(keyBefore + 1);
    expect(isSessionStale(genBefore)).toBe(true);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("handleLogout bumps sessionKey, stales the generation, and flushes live toasts", () => {
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.handleLogin("tokenA", "alice", "Administrator", true);
    });
    showToast("Deleted alice-secret-image", "success");
    expect(document.getElementById("toast-container").childElementCount).toBe(1);

    const genBefore = getSessionGeneration();
    const keyBefore = result.current.sessionKey;
    act(() => {
      result.current.handleLogout();
    });

    expect(result.current.sessionKey).toBe(keyBefore + 1);
    expect(isSessionStale(genBefore)).toBe(true);
    expect(document.getElementById("toast-container").childElementCount).toBe(0);
    expect(localStorage.getItem("authToken")).toBeNull();
  });

  it("handleLogout asks the server to revoke the session it is ending", () => {
    localStorage.setItem("authToken", "tokenA");
    localStorage.setItem("refreshToken", "refreshA");

    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.handleLogout();
    });

    // Deleting local credentials does not invalidate the token: without this
    // call an access token stayed usable for the rest of its 24h TTL and an
    // OAuth refresh token for seven days.
    expect(revokeCalls).toHaveLength(1);
    const { url, body, createCfg } = revokeCalls[0];
    expect(url).toBe("/api/auth/logout");
    expect(createCfg.headers.Authorization).toBe("Bearer tokenA");
    expect(body).toEqual({ refreshToken: "refreshA" });
  });

  it("cross-tab logout during mount verification ends validation instead of hanging", () => {
    localStorage.setItem("authToken", "tokenA");
    // /verify never answers: the tab is torn down while it is in flight.
    axios.get.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useAuth());
    expect(result.current.isValidating).toBe(true);

    // Another tab logs out.
    localStorage.removeItem("authToken");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "authToken" }));
    });

    // Without clearing isValidating the tab renders neither Login nor the app,
    // and the one-shot verify effect never reruns.
    expect(result.current.isValidating).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("cross-tab authToken change detaches this tab without touching shared storage", () => {
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.handleLogin("tokenA", "alice", "Administrator", true);
    });

    // Another tab logs in as bob: shared storage now holds bob's token.
    localStorage.setItem("authToken", "tokenB");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "authToken" }));
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.authToken).toBeNull();
    // The other tab owns those credentials — this tab must not delete them.
    expect(localStorage.getItem("authToken")).toBe("tokenB");
  });

  it("401 from a dead session's request does not log out the current session", async () => {
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.handleLogin("tokenCurrent", "carol", "Administrator", false);
    });

    const onError = lastInterceptorErrorHandler();

    // Late 401 for a request that carried the PREVIOUS session's token.
    await expect(
      onError({
        response: { status: 401 },
        config: { url: "/api/containers", headers: { Authorization: "Bearer tokenDead" } },
      })
    ).rejects.toMatchObject({ response: { status: 401 } });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.authToken).toBe("tokenCurrent");

    // A 401 on the CURRENT token still logs out.
    await act(async () => {
      await expect(
        onError({
          response: { status: 401 },
          config: { url: "/api/containers", headers: { Authorization: "Bearer tokenCurrent" } },
        })
      ).rejects.toBeTruthy();
    });
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("mount-time verify cannot write identity or log out after the session changed", async () => {
    localStorage.setItem("authToken", "tokenA");
    let resolveVerify;
    axios.get.mockImplementation(
      () =>
        new Promise((res) => {
          resolveVerify = res;
        })
    );

    const { result } = renderHook(() => useAuth());

    // Session A's /verify is still in flight when bob logs in (fresh session).
    act(() => {
      result.current.handleLogin("tokenB", "bob", "Administrator", false);
    });

    // A's verify finally answers with A's identity.
    await act(async () => {
      resolveVerify({
        data: { success: true, username: "mallory", role: "Viewer", instanceAdmin: false },
      });
    });

    await waitFor(() => {
      expect(result.current.username).toBe("bob");
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.authToken).toBe("tokenB");
  });

  it("mount-time verify still applies for the live session", async () => {
    localStorage.setItem("authToken", "tokenA");
    axios.get.mockResolvedValue({
      data: { success: true, username: "alice", role: "Viewer", instanceAdmin: false },
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isValidating).toBe(false);
    });
    expect(result.current.username).toBe("alice");
    expect(result.current.userRole).toBe("Viewer");
    expect(result.current.isAuthenticated).toBe(true);
  });
});

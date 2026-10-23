// Regression tests: side effects that outlive a session.
//
// The session-isolation refactor remounts SessionApp on login/logout, so hook
// STATE no longer crosses the boundary — but async continuations still do:
// a pull/clear/delete that finishes after the session changed must not write
// the NEW session's containers/images state, localStorage, or toasts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const graphMock = vi.fn();
const syncMock = vi.fn();
const mutationMock = vi.fn();
const deleteImagesMock = vi.fn();
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  });
  vi.stubGlobal("alert", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
  graphMock.mockReset();
  syncMock.mockReset();
  mutationMock.mockReset();
  deleteImagesMock.mockReset();
  Object.values(toastMock).forEach((fn) => fn.mockClear());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

vi.mock("../../../../graphql/containers", () => ({
  fetchContainersGraphql: (...args) => graphMock(...args),
}));
vi.mock("../../../../graphql/sync", () => ({
  runContainerSync: (...args) => syncMock(...args),
}));
vi.mock("../../../../graphql/client", () => ({
  graphqlClient: { mutation: (...args) => mutationMock(...args) },
}));
vi.mock("../../../../graphql/imageOps", () => ({
  deleteImages: (...args) => deleteImagesMock(...args),
}));
vi.mock("../../../../utils/toast", () => ({
  toast: {
    success: (...a) => toastMock.success(...a),
    error: (...a) => toastMock.error(...a),
    warning: (...a) => toastMock.warning(...a),
    info: (...a) => toastMock.info(...a),
  },
}));

import { useContainerPull } from "../useContainerPull";
import { useContainerClear } from "../useContainerClear";
import { useContainerDeletion } from "../useContainerDeletion";
import { useImageDeletion } from "../../../useContainersPage/hooks/useImageDeletion";
import { clearAllCaches } from "../../../../utils/cacheRegistry";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => act(async () => {});

describe("useContainerPull session guard", () => {
  const setup = () => {
    const setters = {
      setPulling: vi.fn(),
      setError: vi.fn(),
      setPullError: vi.fn(),
      setPullSuccess: vi.fn(),
      setContainers: vi.fn(),
      setStacks: vi.fn(),
      setDockerHubDataPulled: vi.fn(),
      setDataFetched: vi.fn(),
      fetchUnusedImages: vi.fn().mockResolvedValue(undefined),
      successfullyUpdatedContainersRef: { current: new Set() },
    };
    const { result } = renderHook(() => useContainerPull(setters));
    return { setters, handlePull: result.current };
  };

  it("drops the cached-containers response that lands after logout", async () => {
    const d = deferred();
    graphMock.mockReturnValue(d.promise);
    syncMock.mockReturnValue(Promise.resolve({ status: "completed" }));
    const { setters, handlePull } = setup();

    let pull;
    act(() => {
      pull = handlePull();
    });
    // Logout happens while the first fetch is in flight.
    act(() => clearAllCaches());
    d.resolve({ containers: [{ id: "c1" }], stacks: [] });
    await act(async () => {
      await pull;
    });

    expect(setters.setContainers).not.toHaveBeenCalled();
    expect(setters.setStacks).not.toHaveBeenCalled();
    expect(setters.setDataFetched).not.toHaveBeenCalled();
  });

  it("stops after the sync completes in a dead session: no refetch, no storage, no success", async () => {
    const d1 = deferred();
    const sync = deferred();
    graphMock.mockReturnValue(d1.promise);
    syncMock.mockReturnValue(sync.promise);
    const { setters, handlePull } = setup();
    const setLastPullTime = vi.fn();

    let pull;
    act(() => {
      pull = handlePull({ setLastPullTime });
    });
    // The first (cached) fetch lands while the session is still live.
    d1.resolve({ containers: [{ id: "c1" }], stacks: [] });
    await flush();
    expect(setters.setContainers).toHaveBeenCalledTimes(1);

    // Logout while the sync poll is running.
    act(() => clearAllCaches());
    sync.resolve({ status: "completed" });
    await act(async () => {
      await pull;
    });

    // The post-sync refetch must not fire, and none of the completion side
    // effects (storage writes, success toast state, follow-up fetch) may run.
    expect(graphMock).toHaveBeenCalledTimes(1);
    expect(setters.setContainers).toHaveBeenCalledTimes(1);
    expect(setters.setDockerHubDataPulled).not.toHaveBeenCalled();
    expect(localStorage.getItem("dockerHubDataPulled")).toBeNull();
    expect(localStorage.getItem("lastPullTime")).toBeNull();
    expect(setLastPullTime).not.toHaveBeenCalled();
    expect(setters.fetchUnusedImages).not.toHaveBeenCalled();
    // handlePull resets setPullSuccess(null) synchronously on entry, so only a
    // success message would mean the dead session ran to completion.
    expect(setters.setPullSuccess).not.toHaveBeenCalledWith(expect.any(String));
    // The dead session must not clear the loading flag either.
    expect(setters.setPulling).not.toHaveBeenCalledWith(false);
  });

  it("still completes normally for the live session (non-vacuity control)", async () => {
    graphMock.mockResolvedValue({ containers: [{ id: "c2" }], stacks: [] });
    syncMock.mockResolvedValue({ status: "completed" });
    const { setters, handlePull } = setup();

    await act(async () => {
      await handlePull();
    });

    expect(graphMock).toHaveBeenCalledTimes(2);
    expect(setters.setDockerHubDataPulled).toHaveBeenCalledWith(true);
    expect(localStorage.getItem("dockerHubDataPulled")).toBe("true");
    expect(setters.setPullSuccess).toHaveBeenCalledWith("Data pulled successfully!");
    expect(setters.setPulling).toHaveBeenCalledWith(false);
  });
});

describe("useContainerClear session guard", () => {
  const setup = () => {
    const setters = {
      setClearingState: vi.fn(),
      setError: vi.fn(),
      setContainers: vi.fn(),
      setStacks: vi.fn(),
      setUnusedImagesCount: vi.fn(),
      setUnusedImages: vi.fn(),
      setSelectedContainers: vi.fn(),
      setSelectedImages: vi.fn(),
      setDockerHubDataPulled: vi.fn(),
      setDataFetched: vi.fn(),
      fetchContainers: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = renderHook(() => useContainerClear(setters));
    return { setters, handleClear: result.current };
  };

  it("a pending clear mutation completing in a new session does not empty it", async () => {
    const d = deferred();
    mutationMock.mockReturnValue({ toPromise: () => d.promise });
    const { setters, handleClear } = setup();

    let clear;
    act(() => {
      clear = handleClear();
    });
    act(() => clearAllCaches());
    d.resolve({ data: { clearContainerData: { success: true } } });
    await act(async () => {
      await clear;
    });

    expect(setters.setContainers).not.toHaveBeenCalled();
    expect(setters.setStacks).not.toHaveBeenCalled();
    expect(setters.setUnusedImagesCount).not.toHaveBeenCalled();
    expect(setters.setDockerHubDataPulled).not.toHaveBeenCalled();
    expect(localStorage.getItem("dockerHubDataPulled")).toBeNull();
    expect(setters.fetchContainers).not.toHaveBeenCalled();
    expect(setters.setClearingState).not.toHaveBeenCalledWith(false);
  });

  it("still clears for the live session (non-vacuity control)", async () => {
    mutationMock.mockReturnValue({
      toPromise: () => Promise.resolve({ data: { clearContainerData: { success: true } } }),
    });
    const { setters, handleClear } = setup();

    await act(async () => {
      await handleClear();
    });

    expect(setters.setContainers).toHaveBeenCalledWith([]);
    expect(localStorage.getItem("dockerHubDataPulled")).toBe("false");
    expect(setters.fetchContainers).toHaveBeenCalled();
    expect(setters.setClearingState).toHaveBeenCalledWith(false);
  });
});

describe("image deletion session guards (useContainerDeletion + useImageDeletion)", () => {
  it("useContainerDeletion: a late delete does not filter or decrement the new session's list", async () => {
    const d = deferred();
    deleteImagesMock.mockReturnValue(d.promise);
    const setters = {
      unusedImages: [{ id: "img-new", runnerId: 1 }],
      setUnusedImages: vi.fn(),
      setUnusedImagesCount: vi.fn(),
      setSelectedImages: vi.fn(),
      updateLastImageDeleteTime: vi.fn(),
      setDeletingImagesProp: vi.fn(),
    };
    const { result } = renderHook(() => useContainerDeletion(setters));

    let del;
    act(() => {
      del = result.current.handleDeleteImage({ id: "img-old", runnerId: 1 });
    });
    act(() => clearAllCaches());
    d.resolve({ success: true, deleted: 1 });
    await act(async () => {
      await del;
    });

    // The old image id is not in the new session's list: applying the stale
    // completion would still decrement the count and clear the deleting flag.
    expect(setters.setUnusedImages).not.toHaveBeenCalled();
    expect(setters.setUnusedImagesCount).not.toHaveBeenCalled();
    expect(setters.setSelectedImages).not.toHaveBeenCalled();
    expect(setters.updateLastImageDeleteTime).not.toHaveBeenCalled();
    expect(setters.setDeletingImagesProp).not.toHaveBeenCalledWith(false);
  });

  it("useContainerDeletion batch: a late delete does not touch the new session (control + guard)", async () => {
    const setters = {
      unusedImages: [{ id: "img-a", runnerId: 1 }],
      setUnusedImages: vi.fn(),
      setUnusedImagesCount: vi.fn(),
      setSelectedImages: vi.fn(),
      updateLastImageDeleteTime: vi.fn(),
      setDeletingImagesProp: vi.fn(),
    };
    const { result } = renderHook(() => useContainerDeletion(setters));
    vi.stubGlobal("confirm", () => true);

    // Live session control: the batch delete applies.
    deleteImagesMock.mockResolvedValueOnce({ success: true, deleted: 1 });
    await act(async () => {
      await result.current.handleDeleteImages(new Set(["img-a"]));
    });
    expect(setters.setUnusedImages).toHaveBeenCalled();
    expect(setters.setUnusedImagesCount).toHaveBeenCalled();

    // Stale session: nothing applies.
    setters.setUnusedImages.mockClear();
    setters.setUnusedImagesCount.mockClear();
    const d = deferred();
    deleteImagesMock.mockReturnValueOnce(d.promise);
    let del;
    act(() => {
      del = result.current.handleDeleteImages(new Set(["img-a"]));
    });
    act(() => clearAllCaches());
    d.resolve({ success: true, deleted: 1 });
    await act(async () => {
      await del;
    });
    expect(setters.setUnusedImages).not.toHaveBeenCalled();
    expect(setters.setUnusedImagesCount).not.toHaveBeenCalled();
  });

  it("useImageDeletion: a late delete does not mutate the new session or toast", async () => {
    const d = deferred();
    deleteImagesMock.mockReturnValue(d.promise);
    const onUnusedImagesUpdate = vi.fn();
    const onUnusedImagesCountUpdate = vi.fn();
    const setSelectedImages = vi.fn();
    const { result } = renderHook(() =>
      useImageDeletion({ onUnusedImagesUpdate, onUnusedImagesCountUpdate, setSelectedImages })
    );

    let del;
    act(() => {
      del = result.current.executeDeleteImage({ id: "i1", runnerId: 1, repoTags: ["nginx:1"] });
    });
    act(() => clearAllCaches());
    d.resolve({ success: true, deleted: 1 });
    await act(async () => {
      await del;
    });

    expect(onUnusedImagesUpdate).not.toHaveBeenCalled();
    expect(onUnusedImagesCountUpdate).not.toHaveBeenCalled();
    expect(setSelectedImages).not.toHaveBeenCalled();
    expect(toastMock.info).not.toHaveBeenCalled();
  });

  it("useImageDeletion batch: a late delete does not decrement the new session's count", async () => {
    const d = deferred();
    deleteImagesMock.mockReturnValue(d.promise);
    const onUnusedImagesUpdate = vi.fn();
    const onUnusedImagesCountUpdate = vi.fn();
    const { result } = renderHook(() =>
      useImageDeletion({ onUnusedImagesUpdate, onUnusedImagesCountUpdate })
    );

    let del;
    act(() => {
      del = result.current.executeDeleteImages([{ id: "i1", runnerId: 1, repoTags: ["nginx:1"] }]);
    });
    act(() => clearAllCaches());
    d.resolve({ success: true, deleted: 1 });
    await act(async () => {
      await del;
    });

    expect(onUnusedImagesUpdate).not.toHaveBeenCalled();
    expect(onUnusedImagesCountUpdate).not.toHaveBeenCalled();
    expect(toastMock.info).not.toHaveBeenCalled();
  });

  it("useImageDeletion: live-session deletes still apply (non-vacuity control)", async () => {
    deleteImagesMock.mockResolvedValue({ success: true, deleted: 1 });
    const onUnusedImagesUpdate = vi.fn();
    const onUnusedImagesCountUpdate = vi.fn();
    const { result } = renderHook(() =>
      useImageDeletion({ onUnusedImagesUpdate, onUnusedImagesCountUpdate })
    );

    await act(async () => {
      await result.current.executeDeleteImage({ id: "i1", runnerId: 1, repoTags: ["nginx:1"] });
    });

    expect(onUnusedImagesUpdate).toHaveBeenCalled();
    expect(onUnusedImagesCountUpdate).toHaveBeenCalled();
    expect(toastMock.info).toHaveBeenCalled();
  });
});

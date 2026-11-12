import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import axios from "axios";
import { useAvatarManagement } from "../useAvatarManagement";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

describe("avatar API compatibility", () => {
  it("keeps recent avatars returned as URL strings by the Go backend", async () => {
    axios.get.mockResolvedValue({
      data: {
        success: true,
        avatars: ["/api/avatars/recent/one.jpg", { url: "/api/avatars/recent/two.jpg" }, null],
      },
    });
    const { result } = renderHook(() => useAvatarManagement(true, "token"));
    await act(() => result.current.fetchRecentAvatars());
    expect(result.current.recentAvatars).toEqual([
      "/api/avatars/recent/one.jpg",
      "/api/avatars/recent/two.jpg",
    ]);
  });
});

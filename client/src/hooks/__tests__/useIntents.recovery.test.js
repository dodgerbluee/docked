import { renderHook, act, waitFor } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { graphqlClient } from "../../graphql/client";
import { useIntents } from "../useIntents";

vi.mock("../../graphql/client", () => ({ graphqlClient: { query: vi.fn() } }));

it("clears the missing-column read error when a refresh recovers the intents", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    graphqlClient.query.mockReturnValueOnce({
      toPromise: async () => ({ error: new Error("no such column: schedule_timezone") }),
    });
    const { result } = renderHook(() => useIntents(true, "token"));
    await waitFor(() => expect(result.current.error).toContain("schedule_timezone"));
    const intents = [{ id: "1", name: "preserved intent" }];
    graphqlClient.query.mockReturnValueOnce({ toPromise: async () => ({ data: { intents } }) });
    await act(() => result.current.fetchIntents());
    expect(result.current.intents).toEqual(intents);
    expect(result.current.error).toBe("");
  } finally {
    log.mockRestore();
  }
});

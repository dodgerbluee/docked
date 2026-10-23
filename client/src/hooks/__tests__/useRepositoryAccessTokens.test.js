/**
 * Write-path tests for useRepositoryAccessTokens.
 *
 * The API keeps one token per provider and replaces it wholesale, so a blank
 * submission is not "keep the current value" - it erases the stored credential
 * while the UI reports success. The hook must refuse it before sending.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const queryMock = vi.fn();
const mutationMock = vi.fn();
vi.mock("../../graphql/client", () => ({
  graphqlClient: {
    query: (...args) => queryMock(...args),
    mutation: (...args) => mutationMock(...args),
  },
}));

import { useRepositoryAccessTokens } from "../useRepositoryAccessTokens";

// urql-shaped operation handle
function op(promise) {
  return { toPromise: () => promise };
}

describe("useRepositoryAccessTokens writes", () => {
  beforeEach(() => {
    queryMock.mockReturnValue(op(Promise.resolve({ data: { repositoryTokens: [] } })));
    mutationMock.mockReturnValue(
      op(Promise.resolve({ data: { saveRepositoryToken: { id: "7", provider: "github" } } }))
    );
  });

  it("refuses a blank token without calling the API", async () => {
    const { result } = renderHook(() => useRepositoryAccessTokens({}));

    let out;
    await act(async () => {
      out = await result.current.createOrUpdateToken("github", "   ");
    });

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/required/i);
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it("saves the trimmed token for the provider", async () => {
    const { result } = renderHook(() => useRepositoryAccessTokens({}));

    let out;
    await act(async () => {
      out = await result.current.createOrUpdateToken("github", "  ghp_secret  ");
    });

    expect(out.success).toBe(true);
    expect(out.id).toBe("7");
    expect(mutationMock).toHaveBeenCalledWith(expect.anything(), {
      input: { provider: "github", token: "ghp_secret" },
    });
  });

  it("surfaces an API failure instead of reporting success", async () => {
    mutationMock.mockReturnValue(op(Promise.resolve({ error: { message: "boom" } })));
    const { result } = renderHook(() => useRepositoryAccessTokens({}));

    let out;
    await act(async () => {
      out = await result.current.createOrUpdateToken("gitlab", "glpat-x");
    });

    expect(out.success).toBe(false);
    expect(out.error).toBe("boom");
  });
});

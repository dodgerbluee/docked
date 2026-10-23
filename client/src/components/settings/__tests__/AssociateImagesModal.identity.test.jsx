import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  // Header renders ThemeToggle, which needs matchMedia.
  vi.stubGlobal("matchMedia", (query) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
});

const queryMock = vi.fn();
const mutationMock = vi.fn();
vi.mock("../../../graphql/client", () => ({
  graphqlClient: {
    query: (...args) => queryMock(...args),
    mutation: (...args) => mutationMock(...args),
  },
}));

const containersGraphqlMock = vi.fn();
vi.mock("../../../graphql/containers", () => ({
  fetchContainersGraphql: (...args) => containersGraphqlMock(...args),
}));

import AssociateImagesModal from "../AssociateImagesModal";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const TOKEN_A = { id: 1, name: "alpha-token", provider: "github" };
const TOKEN_B = { id: 2, name: "beta-token", provider: "github" };

describe("AssociateImagesModal token identity", () => {
  it("drops container/association responses for a token that is no longer selected", async () => {
    const containersA = deferred();
    const assocA = deferred();
    const containersB = deferred();
    const assocB = deferred();

    containersGraphqlMock
      .mockReturnValueOnce(containersA.promise)
      .mockReturnValueOnce(containersB.promise);
    queryMock
      .mockReturnValueOnce({ toPromise: () => assocA.promise })
      .mockReturnValueOnce({ toPromise: () => assocB.promise });

    const { rerender } = render(<AssociateImagesModal isOpen onClose={() => {}} token={TOKEN_A} />);
    await waitFor(() => expect(containersGraphqlMock).toHaveBeenCalledTimes(1));

    // The modal is never unmounted: the parent just re-points it at token B.
    rerender(<AssociateImagesModal isOpen onClose={() => {}} token={TOKEN_B} />);
    await waitFor(() => expect(containersGraphqlMock).toHaveBeenCalledTimes(2));

    // B's responses land first...
    containersB.resolve({ containers: [{ imageRepo: "ghcr.io/beta-app", image: "beta-app" }] });
    assocB.resolve({ data: { repositoryTokens: [{ id: 2, associatedImages: [] }] }, error: null });
    await waitFor(() => expect(screen.queryByText("ghcr.io/beta-app")).not.toBeNull());

    // ...and A's arrive late. They must not replace B's list or B's selection.
    containersA.resolve({ containers: [{ imageRepo: "ghcr.io/alpha-secret", image: "alpha" }] });
    assocA.resolve({
      data: {
        repositoryTokens: [{ id: 1, associatedImages: [{ imageRepo: "ghcr.io/alpha-secret" }] }],
      },
      error: null,
    });
    await waitFor(() => expect(assocA.promise).resolves.toBeTruthy());

    expect(screen.queryByText("ghcr.io/alpha-secret")).toBeNull();
    expect(screen.getByText("ghcr.io/beta-app")).toBeInTheDocument();
  });

  it("saves the new token's own selection, not the previous token's", async () => {
    const assocA = deferred();

    containersGraphqlMock
      .mockResolvedValueOnce({ containers: [{ imageRepo: "ghcr.io/alpha-secret", image: "a" }] })
      .mockResolvedValueOnce({ containers: [{ imageRepo: "ghcr.io/beta-app", image: "b" }] });
    queryMock.mockReturnValueOnce({ toPromise: () => assocA.promise }).mockReturnValueOnce({
      toPromise: () =>
        Promise.resolve({
          data: {
            repositoryTokens: [{ id: 2, associatedImages: [{ imageRepo: "ghcr.io/beta-app" }] }],
          },
          error: null,
        }),
    });
    mutationMock.mockReturnValue({ toPromise: () => Promise.resolve({ error: null }) });

    const { rerender } = render(<AssociateImagesModal isOpen onClose={() => {}} token={TOKEN_A} />);
    rerender(<AssociateImagesModal isOpen onClose={() => {}} token={TOKEN_B} />);

    await waitFor(() => expect(screen.getByText("ghcr.io/beta-app")).toBeInTheDocument());

    // A's stale association list arrives after B is already showing.
    assocA.resolve({
      data: {
        repositoryTokens: [{ id: 1, associatedImages: [{ imageRepo: "ghcr.io/alpha-secret" }] }],
      },
      error: null,
    });
    await waitFor(() => expect(assocA.promise).resolves.toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(mutationMock).toHaveBeenCalledTimes(1));

    const [, variables] = mutationMock.mock.calls[0];
    expect(variables.tokenId).toBe("2");
    expect(variables.input.imageRepos).toEqual(["ghcr.io/beta-app"]);
  });
});

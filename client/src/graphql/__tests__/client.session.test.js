import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  const store = new Map([["authToken", "tok"]]);
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});

import { graphqlClient, resetGraphQLClient } from "../client";

function gatedFetch(counter) {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const fetchMock = vi.fn(async () => {
    counter.n += 1;
    await gate;
    return new Response(JSON.stringify({ data: { ping: "pong" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { release };
}

describe("graphql client session isolation", () => {
  it("dedupes within a session but not across a client reset", async () => {
    const counter = { n: 0 };
    const { release } = gatedFetch(counter);

    const DOC = "query Ping { ping }";
    // Two identical in-flight queries in the SAME session share one request.
    const p1 = graphqlClient.query(DOC).toPromise();
    const p2 = graphqlClient.query(DOC).toPromise();
    release();
    await Promise.all([p1, p2]);
    expect(counter.n).toBe(1);

    // Logout + login swaps the client instance: the new session must make its
    // own request instead of being handed the previous session's response.
    resetGraphQLClient();
    const { release: release2 } = gatedFetch(counter);
    const p3 = graphqlClient.query(DOC).toPromise();
    release2();
    await p3;
    expect(counter.n).toBe(2);
  });
});

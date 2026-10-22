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

  it("disposes the old WebSocket on reset so the new session gets a fresh socket", async () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const instances = [];
    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.closed = false;
        instances.push(this);
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.();
        }, 0);
      }
      send(data) {
        // Ack the handshake so graphql-ws resolves its connecting promise;
        // dispose() awaits that promise before closing the socket.
        try {
          if (JSON.parse(data).type === "connection_init") {
            setTimeout(() => {
              this.onmessage?.({ data: JSON.stringify({ type: "connection_ack" }) });
            }, 0);
          }
        } catch {
          /* not JSON under test */
        }
      }
      close() {
        this.closed = true;
        this.readyState = 3;
        this.onclose?.({ code: 1000, reason: "", wasClean: true });
      }
      addEventListener() {}
      removeEventListener() {}
    }
    // graphql-ws v6 captures the WebSocket implementation at createClient
    // time, so the stub must be in place BEFORE the client is (re)built.
    vi.stubGlobal("WebSocket", FakeWebSocket);
    resetGraphQLClient();

    const sub1 = graphqlClient.subscription("subscription S { ping }").subscribe(() => {});
    await tick(); // urql starts async → socket created
    expect(instances.length).toBe(1);
    await tick(); // socket opens → connection_init sent
    await tick(); // connection_ack → connecting resolved

    // The old socket authenticated with the previous session's JWT in
    // connectionParams; it must not survive into the next session.
    resetGraphQLClient();
    await tick(); // dispose awaits the open connection, then closes it
    expect(instances[0].closed).toBe(true);

    const sub2 = graphqlClient.subscription("subscription S { ping }").subscribe(() => {});
    await tick();
    expect(instances.length).toBe(2);
    expect(instances[1]).not.toBe(instances[0]);

    sub1.unsubscribe();
    sub2.unsubscribe();
  });
});

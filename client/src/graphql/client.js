import { createClient, fetchExchange, subscriptionExchange } from "urql";
import { createClient as createWsClient } from "graphql-ws";

/**
 * urql client that attaches the Bearer token from localStorage on every request.
 * Points at /graphql which Vite proxies to the Go backend on :4000.
 *
 * Subscriptions ride a graphql-transport-ws WebSocket on the same /graphql
 * path (Vite ws proxy in dev, Node upgrade proxy in production). The JWT
 * rides in connectionParams — the only place a token can travel on a WS
 * handshake; the Go backend rejects unauthenticated connections with 4401.
 */
const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/graphql`;

function buildWsClient() {
  return createWsClient({
    url: wsUrl,
    connectionParams: () => {
      const token = localStorage.getItem("authToken");
      return token ? { token } : {};
    },
    // 4401/4403 are terminal: don't hammer the server with a stale token.
    retryAttempts: 3,
    shouldRetry: (code) => code !== 4401 && code !== 4403,
  });
}

function buildClient(ws) {
  return createClient({
    url: "/graphql",
    exchanges: [
      subscriptionExchange({
        // graphql-ws's subscribe() returns an unsubscribe fn; urql expects an
        // observable-ish { subscribe(sink) => { unsubscribe } } adapter.
        // The ws instance is bound per urql client so a reset can never pair a
        // new session's urql with the previous session's authenticated socket.
        forwardSubscription: (operation) => ({
          subscribe: (sink) => ({
            unsubscribe: ws.subscribe(
              { query: operation.query, variables: operation.variables },
              sink
            ),
          }),
        }),
      }),
      fetchExchange,
    ],
    fetchOptions: () => {
      const token = localStorage.getItem("authToken");
      return {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      };
    },
  });
}

// A swappable urql+graphql-ws pair behind a stable facade. urql deduplicates
// identical in-flight queries WITHIN one client instance, and graphql-ws
// multiplexes every subscription over ONE socket authenticated at connect
// time: if either survived a logout, user B could be handed user A's in-flight
// response or A's still-authenticated event stream. resetGraphQLClient()
// disposes both and gives every session its own pair.
let activeWs = buildWsClient();
let activeClient = buildClient(activeWs);

export const graphqlClient = {
  query: (doc, vars) => activeClient.query(doc, vars),
  mutation: (doc, vars) => activeClient.mutation(doc, vars),
  subscription: (doc, vars) => activeClient.subscription(doc, vars),
  subscribe: (doc, vars, policy) => activeClient.subscribe(doc, vars, policy),
};

/** Replace the active urql client AND its WebSocket (call on logout AND login). */
export function resetGraphQLClient() {
  // dispose() permanently kills the old graphql-ws client (v6 API): it closes
  // the socket and blocks reconnects. The old socket carries the previous
  // session's JWT in its connection params, so it must never be reused.
  Promise.resolve(activeWs.dispose()).catch(() => {});
  activeWs = buildWsClient();
  activeClient = buildClient(activeWs);
}

// Fire-and-forget logout revocation. Reads the token synchronously (before the
// caller clears localStorage) and posts the logout mutation with it captured in
// the request body, so the Go backend records it in revoked_tokens and rejects
// replays until the token would have expired on its own. A plain fetch (rather
// than the urql client) is deliberate: the client re-reads localStorage at
// fetch time, which would race with the local token clear that follows.
// Best-effort — failures are ignored; the local session is cleared regardless.
export function revokeCurrentSession() {
  const token = localStorage.getItem("authToken");
  if (!token) {
    return;
  }
  // OAuth sessions also store a refresh token; hand it to the server so the
  // whole session dies, not just the (short-lived) access token.
  const refreshToken = localStorage.getItem("refreshToken");
  fetch("/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: "mutation ($refreshToken: String) { logout(refreshToken: $refreshToken) { success } }",
      variables: { refreshToken: refreshToken || null },
    }),
    keepalive: true,
  }).catch(() => {});
}

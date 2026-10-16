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

export const wsClient = createWsClient({
  url: wsUrl,
  connectionParams: () => {
    const token = localStorage.getItem("authToken");
    return token ? { token } : {};
  },
  // 4401/4403 are terminal: don't hammer the server with a stale token.
  retryAttempts: 3,
  shouldRetry: (code) => code !== 4401 && code !== 4403,
});

export const graphqlClient = createClient({
  url: "/graphql",
  exchanges: [
    subscriptionExchange({
      // graphql-ws's subscribe() returns an unsubscribe fn; urql expects an
      // observable-ish { subscribe(sink) => { unsubscribe } } adapter.
      forwardSubscription: (operation) => ({
        subscribe: (sink) => ({
          unsubscribe: wsClient.subscribe(
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

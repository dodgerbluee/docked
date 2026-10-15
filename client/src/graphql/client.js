import { createClient, fetchExchange } from "urql";

/**
 * urql client that attaches the Bearer token from localStorage on every request.
 * Points at /graphql which Vite proxies to the Go backend on :4000.
 */
export const graphqlClient = createClient({
  url: "/graphql",
  exchanges: [fetchExchange],
  fetchOptions: () => {
    const token = localStorage.getItem("authToken");
    return {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    };
  },
});

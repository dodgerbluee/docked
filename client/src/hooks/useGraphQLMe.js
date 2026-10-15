import { useEffect } from "react";
import { useQuery } from "urql";
import { ME_QUERY } from "../graphql/queries";

/**
 * Fetches the current user via GraphQL.
 * Drop-in replacement for the old axios GET /api/auth/me call.
 */
export function useGraphQLMe(isAuthenticated) {
  const [result, reexecute] = useQuery({
    query: ME_QUERY,
    pause: !isAuthenticated,
  });

  const userInfo = result.data?.me ?? null;
  const loading = result.fetching;
  const error = result.error ? result.error.message : null;

  // Refetch when auth state changes
  useEffect(() => {
    if (isAuthenticated) reexecute({ requestPolicy: "network-only" });
  }, [isAuthenticated, reexecute]);

  return { userInfo, loading, error, refetch: () => reexecute({ requestPolicy: "network-only" }) };
}

import { useQuery } from "urql";
import { SUMMARY_STATS_QUERY } from "../graphql/queries";

/**
 * Fetches server-side aggregate counts via GraphQL.
 * Useful for the dashboard hero stats without loading all containers client-side.
 */
export function useGraphQLSummaryStats(isAuthenticated) {
  const [result, reexecute] = useQuery({
    query: SUMMARY_STATS_QUERY,
    pause: !isAuthenticated,
  });

  const stats = result.data?.summaryStats ?? null;
  const loading = result.fetching;
  const error = result.error ? result.error.message : null;

  return { stats, loading, error, refetch: () => reexecute({ requestPolicy: "network-only" }) };
}

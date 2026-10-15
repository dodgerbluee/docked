import { useCallback } from "react";
import { useQuery, useMutation } from "urql";
import { USER_PREFERENCES_QUERY, UPDATE_USER_PREFERENCES_MUTATION } from "../graphql/queries";

/**
 * Single GraphQL query for all user preferences + single mutation to save them.
 * Replaces the old separate REST calls to /api/settings/color-scheme and
 * /api/settings/refreshing-toggles-enabled.
 */
export function useGraphQLPreferences(isAuthenticated) {
  const [result, reexecute] = useQuery({
    query: USER_PREFERENCES_QUERY,
    pause: !isAuthenticated,
  });

  const [updateResult, executeUpdate] = useMutation(UPDATE_USER_PREFERENCES_MUTATION);

  const prefs = result.data?.userPreferences ?? null;
  const loading = result.fetching;
  const error = result.error ? result.error.message : null;

  const savePreferences = useCallback(
    async (input) => {
      const res = await executeUpdate({ input });
      if (res.error) {
        return { success: false, error: res.error.message };
      }
      // Optimistically update the local cache
      reexecute({ requestPolicy: "network-only" });
      return { success: res.data?.updateUserPreferences?.success ?? false };
    },
    [executeUpdate, reexecute]
  );

  return {
    prefs,
    loading,
    error,
    savePreferences,
    saving: updateResult.fetching,
    refetch: () => reexecute({ requestPolicy: "network-only" }),
  };
}

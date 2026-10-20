/**
 * Hook for fetching and managing container data
 */

import { useState, useEffect, useCallback } from "react";
import { graphqlClient } from "../../../../graphql/client";
import { CONTAINER_DATA_QUERY } from "../../../../graphql/queries";

/**
 * Hook to fetch and manage container data
 * @returns {Object} Container data state and fetch function
 */
export const useContainerData = () => {
  const [dataEntries, setDataEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchContainerData = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);

      const result = await graphqlClient.query(CONTAINER_DATA_QUERY, {}).toPromise();

      if (result.error) throw result.error;

      const payload = result.data?.containerData;
      if (payload?.success) {
        const entries = payload.entries || [];
        const rawDatabaseRecords = payload.rawDatabaseRecords || {};
        const correlatedRecords = payload.correlatedRecords || {};

        // Attach raw database records and correlated records to the first entry for easy access
        if (entries.length > 0) {
          if (Object.keys(rawDatabaseRecords).length > 0) {
            entries[0].rawDatabaseRecords = rawDatabaseRecords;
          }
          if (Object.keys(correlatedRecords).length > 0) {
            entries[0].correlatedRecords = correlatedRecords;
          }
        }

        setDataEntries(entries);
      } else {
        setError(payload?.error || "Failed to fetch container data");
      }
    } catch (err) {
      console.error("Error fetching container data:", err);
      setError(err?.message || "Failed to fetch container data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContainerData();
  }, [fetchContainerData]);

  return {
    dataEntries,
    loading,
    error,
    fetchContainerData,
  };
};

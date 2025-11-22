/**
 * Hook for fetching and managing container data
 */

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../../utils/api";

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

      const response = await axios.get(`${API_BASE_URL}/api/containers/data`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
      });

      if (response.data.success) {
        const entries = response.data.entries || [];
        const rawDatabaseRecords = response.data.rawDatabaseRecords || {};
        const correlatedRecords = response.data.correlatedRecords || {};
        
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
        setError(response.data.error || "Failed to fetch container data");
      }
    } catch (err) {
      console.error("Error fetching container data:", err);
      const errorMessage =
        err.response?.data?.error || err.message || "Failed to fetch container data";
      setError(errorMessage);
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

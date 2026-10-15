import { useState, useEffect, useCallback, useRef } from "react";
import { graphqlClient } from "../graphql/client";
import { BATCH_CONFIGS_QUERY } from "../graphql/queries";

const DEFAULTS = {
  "docker-hub-pull": { enabled: false, intervalMinutes: 60 },
  "tracked-apps-check": { enabled: false, intervalMinutes: 60 },
  "app-version-scan": { enabled: false, intervalMinutes: 60 },
};

function mapConfigs(items) {
  const out = { ...DEFAULTS };
  for (const item of items || []) {
    // GraphQL returns jobType as an UPPER_SNAKE enum (e.g. DOCKER_HUB_PULL);
    // the UI keys on hyphenated-lowercase (docker-hub-pull).
    const key = (item.jobType || "").toLowerCase().replace(/_/g, "-");
    out[key] = {
      enabled: item.enabled,
      intervalMinutes: item.intervalMinutes,
    };
  }
  return out;
}

/**
 * Custom hook for batch configuration management
 * Fetches batch configuration via GraphQL
 */
export const useBatchConfig = (isAuthenticated, authToken) => {
  const [batchConfig, setBatchConfig] = useState(DEFAULTS);

  // Fetch batch configuration (guard prevents StrictMode double-fetch)
  const fetchDoneRef = useRef(false);
  useEffect(() => {
    if (isAuthenticated && authToken && !fetchDoneRef.current) {
      fetchDoneRef.current = true;
      const fetchBatchConfig = async () => {
        try {
          const result = await graphqlClient.query(BATCH_CONFIGS_QUERY).toPromise();
          if (result.data?.batchConfigs) {
            setBatchConfig(mapConfigs(result.data.batchConfigs));
          }
        } catch (err) {
          console.error("Error fetching batch config:", err);
        }
      };
      fetchBatchConfig();
    }
  }, [isAuthenticated, authToken]);

  // Refetch batch config after update
  const handleBatchConfigUpdate = useCallback(async () => {
    try {
      const result = await graphqlClient.query(BATCH_CONFIGS_QUERY).toPromise();
      if (result.data?.batchConfigs) {
        setBatchConfig(mapConfigs(result.data.batchConfigs));
      }
    } catch (err) {
      console.error("Error refetching batch config:", err);
    }
  }, []);

  return {
    batchConfig,
    setBatchConfig,
    handleBatchConfigUpdate,
  };
};

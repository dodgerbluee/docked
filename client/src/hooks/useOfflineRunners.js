import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

const POLL_INTERVAL = 60_000; // 1 minute

export function useOfflineRunners(isAuthenticated) {
  const [offlineRunners, setOfflineRunners] = useState([]);

  const fetchRunnerStatus = useCallback(async () => {
    if (!isAuthenticated) {
      setOfflineRunners([]);
      return;
    }
    try {
      const { data } = await axios.get(`${API_BASE_URL}/api/runners`);
      if (data.success && Array.isArray(data.runners)) {
        const offline = data.runners.filter(
          (r) => r.enabled && r.online_status === "offline"
        );
        setOfflineRunners(offline);
      }
    } catch {
      // Silently ignore — don't show stale data as offline
    }
  }, [isAuthenticated]);

  useEffect(() => {
    fetchRunnerStatus();
    const id = setInterval(fetchRunnerStatus, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchRunnerStatus]);

  return offlineRunners;
}

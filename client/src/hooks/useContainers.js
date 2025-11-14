/**
 * Custom hook for fetching and managing containers
 */

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// In production, API is served from same origin, so use relative URLs
import { API_BASE_URL } from "../constants/api";

export function useContainers() {
  const [containers, setContainers] = useState([]);
  const [stacks, setStacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [unusedImagesCount, setUnusedImagesCount] = useState(0);

  const fetchContainers = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/api/containers`);
      // Handle both grouped and flat response formats
      if (response.data.grouped && response.data.stacks) {
        setContainers(response.data.containers);
        setStacks(response.data.stacks);
        setUnusedImagesCount(response.data.unusedImagesCount || 0);
      } else {
        // Backward compatibility: treat as flat array
        setContainers(Array.isArray(response.data) ? response.data : []);
        setStacks([]);
        setUnusedImagesCount(0);
      }
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch containers');
      console.error('Error fetching containers:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContainers();
  }, [fetchContainers]);

  return {
    containers,
    stacks,
    loading,
    error,
    unusedImagesCount,
    refetch: fetchContainers,
  };
}


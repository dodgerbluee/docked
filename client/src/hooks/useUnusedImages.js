/**
 * Custom hook for fetching unused images
 */

import { useState, useCallback } from 'react';
import axios from 'axios';

// In production, API is served from same origin, so use relative URLs
const API_BASE_URL = process.env.REACT_APP_API_URL || 
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');

export function useUnusedImages() {
  const [unusedImages, setUnusedImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchUnusedImages = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/api/images/unused`);
      setUnusedImages(response.data.unusedImages || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch unused images');
      console.error('Error fetching unused images:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    unusedImages,
    loading,
    error,
    refetch: fetchUnusedImages,
  };
}


import { useState, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../constants/api";

/**
 * Custom hook for tracked images management
 * Handles fetching tracked images for summary statistics
 */
export const useTrackedImages = () => {
  const [trackedImages, setTrackedImages] = useState([]);

  // Fetch tracked images for summary statistics
  const fetchTrackedImages = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/tracked-images`);
      if (response.data.success) {
        const images = response.data.images || [];

        // Sort alphabetically by name
        const sortedImages = images.sort((a, b) => {
          const nameA = (a.name || "").toLowerCase();
          const nameB = (b.name || "").toLowerCase();
          return nameA.localeCompare(nameB);
        });

        setTrackedImages(sortedImages);

        // Set last scan time from the most recent last_checked
        // Note: lastScanTime is now managed by the useTrackedApps hook in TrackedAppsPage
        // This function only fetches tracked images for summary statistics
      }
    } catch (err) {
      console.error("Error fetching tracked images:", err);
    }
  }, []);

  return {
    trackedImages,
    setTrackedImages,
    fetchTrackedImages,
  };
};

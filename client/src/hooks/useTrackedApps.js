/**
 * Custom hook for Tracked Apps functionality
 * Manages state and operations for tracked Docker images and GitHub repositories
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { parseUTCTimestamp } from '../utils/formatters';

// In production, API is served from same origin, so use relative URLs
const API_BASE_URL =
  process.env.REACT_APP_API_URL ||
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');

/**
 * Custom hook for managing tracked apps
 * @returns {Object} Tracked apps state and handlers
 */
export function useTrackedApps() {
  const [trackedImages, setTrackedImages] = useState([]);
  const [trackedImageError, setTrackedImageError] = useState('');
  const [trackedImageSuccess, setTrackedImageSuccess] = useState('');
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [lastScanTime, setLastScanTime] = useState(null);
  const [editingTrackedImageData, setEditingTrackedImageData] = useState(null);
  const [showAddTrackedImageModal, setShowAddTrackedImageModal] = useState(false);
  const [clearingGitHubCache, setClearingGitHubCache] = useState(false);

  const fetchTrackedImages = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/tracked-images`);
      if (response.data.success) {
        const images = response.data.images || [];

        // Sort alphabetically by name
        const sortedImages = images.sort((a, b) => {
          const nameA = (a.name || '').toLowerCase();
          const nameB = (b.name || '').toLowerCase();
          return nameA.localeCompare(nameB);
        });

        setTrackedImages(sortedImages);

        // Set last scan time from the most recent last_checked
        if (images.length > 0) {
          const mostRecentCheck = images
            .map((img) => img.last_checked)
            .filter(Boolean)
            .sort((a, b) => {
              const dateA = parseUTCTimestamp(a);
              const dateB = parseUTCTimestamp(b);
              return dateB.getTime() - dateA.getTime();
            })[0];
          if (mostRecentCheck) {
            // Parse as UTC timestamp (database stores in UTC without timezone info)
            setLastScanTime(parseUTCTimestamp(mostRecentCheck));
          }
        }
      }
    } catch (err) {
      console.error('Error fetching tracked images:', err);
    }
  }, []);

  // Fetch tracked images on mount
  useEffect(() => {
    fetchTrackedImages();
  }, [fetchTrackedImages]);

  const handleTrackedImageModalSuccess = useCallback(async () => {
    await fetchTrackedImages();
    setTrackedImageSuccess('Tracked item added successfully!');
    setTimeout(() => setTrackedImageSuccess(''), 3000);
  }, [fetchTrackedImages]);

  const handleDeleteTrackedImage = useCallback(async (id) => {
    if (!window.confirm('Are you sure you want to remove this tracked image?')) {
      return;
    }

    try {
      const response = await axios.delete(
        `${API_BASE_URL}/api/tracked-images/${id}`
      );
      if (response.data.success) {
        await fetchTrackedImages();
      } else {
        setTrackedImageError(
          response.data.error || 'Failed to delete tracked image'
        );
      }
    } catch (err) {
      setTrackedImageError(
        err.response?.data?.error || 'Failed to delete tracked image'
      );
    }
  }, [fetchTrackedImages]);

  const handleUpgradeTrackedImage = useCallback(async (id, latestVersion) => {
    try {
      const response = await axios.put(
        `${API_BASE_URL}/api/tracked-images/${id}`,
        {
          current_version: latestVersion,
        }
      );
      if (response.data.success) {
        await fetchTrackedImages();
        setTrackedImageSuccess('Current version updated successfully!');
        setTimeout(() => setTrackedImageSuccess(''), 3000);
      } else {
        setTrackedImageError(
          response.data.error || 'Failed to update current version'
        );
      }
    } catch (err) {
      setTrackedImageError(
        err.response?.data?.error || 'Failed to update current version'
      );
    }
  }, [fetchTrackedImages]);

  const handleEditTrackedImage = useCallback((image) => {
    setEditingTrackedImageData(image);
    setShowAddTrackedImageModal(true);
  }, []);

  const handleCheckTrackedImagesUpdates = useCallback(async () => {
    setCheckingUpdates(true);
    setTrackedImageError('');
    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/tracked-images/check-updates`
      );
      if (response.data.success) {
        await fetchTrackedImages();
        setLastScanTime(new Date());
        setTrackedImageSuccess('Update check completed!');
        setTimeout(() => setTrackedImageSuccess(''), 3000);
      }
    } catch (err) {
      setTrackedImageError(
        err.response?.data?.error || 'Failed to check for updates'
      );
    } finally {
      setCheckingUpdates(false);
    }
  }, [fetchTrackedImages]);

  // Batch handler for tracked apps updates check
  const handleBatchTrackedAppsCheck = useCallback(async () => {
    let runId = null;
    const logs = [];

    const log = (message) => {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${message}`;
      logs.push(logEntry);
      console.log(logEntry);
    };

    try {
      // Create batch run record
      log('Starting tracked apps batch check process...');
      const runResponse = await axios.post(`${API_BASE_URL}/api/batch/runs`, {
        status: 'running',
        jobType: 'tracked-apps-check',
      });
      runId = runResponse.data.runId;
      log(`Batch run ${runId} created`);

      setCheckingUpdates(true);
      log('🔄 Checking for tracked app updates...');

      // Start the check operation
      log('Initiating tracked apps update check...');
      const response = await axios.post(
        `${API_BASE_URL}/api/tracked-images/check-updates`,
        {},
        {
          timeout: 300000, // 5 minute timeout
        }
      );

      if (response.data.success) {
        log('Tracked apps check completed successfully');

        // Wait a moment for database updates to complete
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Fetch updated tracked images to get accurate counts
        const updatedResponse = await axios.get(
          `${API_BASE_URL}/api/tracked-images`
        );
        if (!updatedResponse.data.success) {
          throw new Error('Failed to fetch updated tracked images');
        }
        const updatedImages = updatedResponse.data.images || [];
        const appsChecked = updatedImages.length;
        const appsWithUpdates = updatedImages.filter((img) =>
          Boolean(img.has_update)
        ).length;
        log(
          `Processed ${appsChecked} tracked apps, ${appsWithUpdates} with updates available`
        );

        // Update UI state
        await fetchTrackedImages();
        setLastScanTime(new Date());

        // Update batch run as completed
        if (runId) {
          await axios.put(`${API_BASE_URL}/api/batch/runs/${runId}`, {
            status: 'completed',
            containersChecked: appsChecked,
            containersUpdated: appsWithUpdates,
            logs: logs.join('\n'),
          });
          log(`Batch run ${runId} marked as completed`);
        }
      } else {
        throw new Error(response.data.error || 'Failed to check tracked apps');
      }
    } catch (err) {
      let errorMessage =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        'Failed to check tracked apps';
      log(`❌ Error: ${errorMessage}`);
      console.error('Error checking tracked apps:', err);

      // Update batch run as failed
      if (runId) {
        try {
          await axios.put(`${API_BASE_URL}/api/batch/runs/${runId}`, {
            status: 'failed',
            errorMessage,
            logs: logs.join('\n'),
          });
          log(`Batch run ${runId} marked as failed`);
        } catch (updateErr) {
          console.error('Error updating batch run:', updateErr);
        }
      }
    } finally {
      setCheckingUpdates(false);
      log('Tracked apps batch check process finished (success or failure)');
    }
  }, [fetchTrackedImages]);

  const handleClearGitHubCache = useCallback(async () => {
    if (
      !window.confirm(
        "Are you sure you want to clear the latest version data for all tracked apps? This will reset the 'Latest' version information and force fresh data to be fetched on the next check."
      )
    ) {
      return;
    }

    try {
      setClearingGitHubCache(true);
      setTrackedImageError(null);
      console.log('🗑️ Clearing latest version data for tracked apps...');

      const response = await axios.delete(
        `${API_BASE_URL}/api/tracked-images/cache`
      );

      if (response.data && response.data.success) {
        console.log('✅ Latest version data cleared successfully');
        const message =
          response.data.message || 'Latest version data cleared successfully';
        setTrackedImageSuccess(message);
        setTimeout(() => setTrackedImageSuccess(''), 3000);

        // Refresh tracked images to show updated data
        await fetchTrackedImages();
      } else {
        setTrackedImageError('Failed to clear latest version data');
      }
    } catch (err) {
      const errorMessage =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        'Failed to clear latest version data';
      setTrackedImageError(errorMessage);
      console.error('Error clearing latest version data:', err);
    } finally {
      setClearingGitHubCache(false);
    }
  }, [fetchTrackedImages]);

  return {
    // State
    trackedImages,
    trackedImageError,
    trackedImageSuccess,
    checkingUpdates,
    lastScanTime,
    editingTrackedImageData,
    showAddTrackedImageModal,
    clearingGitHubCache,
    // Actions
    fetchTrackedImages,
    handleTrackedImageModalSuccess,
    handleDeleteTrackedImage,
    handleUpgradeTrackedImage,
    handleEditTrackedImage,
    handleCheckTrackedImagesUpdates,
    handleBatchTrackedAppsCheck,
    handleClearGitHubCache,
    // Setters
    setTrackedImageError,
    setTrackedImageSuccess,
    setEditingTrackedImageData,
    setShowAddTrackedImageModal,
  };
}


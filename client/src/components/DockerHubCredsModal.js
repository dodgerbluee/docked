/**
 * Docker Hub Credentials Modal
 * Popup form to add or edit Docker Hub credentials
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './AddPortainerModal.css';

// In production, API is served from same origin, so use relative URLs
const API_BASE_URL = process.env.REACT_APP_API_URL || 
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');

function DockerHubCredsModal({ isOpen, onClose, onSuccess, existingCredentials = null }) {
  const [formData, setFormData] = useState({
    username: '',
    token: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Clear form and error when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      if (existingCredentials) {
        // Edit mode - populate with existing username, but not token
        setFormData({
          username: existingCredentials.username || '',
          token: '',
        });
      } else {
        // Create mode - clear form
        setFormData({
          username: '',
          token: '',
        });
      }
      setError('');
    }
  }, [isOpen, existingCredentials]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    // Clear error when user starts typing
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const username = formData.username.trim();
      const token = formData.token.trim();

      // Validate required fields
      if (!username) {
        setError('Docker Hub username is required');
        setLoading(false);
        return;
      }

      // Token is required for new credentials, optional for editing (to keep existing)
      if (!existingCredentials && !token) {
        setError('Personal Access Token is required');
        setLoading(false);
        return;
      }

      // If we have a new token, validate it first
      if (token) {
        try {
          const validateResponse = await axios.post(
            `${API_BASE_URL}/api/docker-hub/credentials/validate`,
            {
              username: username,
              token: token,
            }
          );

          if (!validateResponse.data.success) {
            setError(
              validateResponse.data.error || 'Authentication validation failed'
            );
            setLoading(false);
            return;
          }
        } catch (validateErr) {
          setError(
            validateErr.response?.data?.error ||
              'Authentication failed. Please check your username and token.'
          );
          setLoading(false);
          return;
        }
      }

      // Authentication successful (or no new token provided for edit), now save
      const response = await axios.post(
        `${API_BASE_URL}/api/docker-hub/credentials`,
        {
          username: username,
          token: token || '', // Empty string if no new token (will use existing)
        }
      );

      if (response.data.success) {
        // Clear form
        setFormData({
          username: '',
          token: '',
        });
        // Call success callback
        if (onSuccess) {
          onSuccess();
        }
        // Close modal
        onClose();
      } else {
        setError(
          response.data.error || 'Failed to save Docker Hub credentials'
        );
      }
    } catch (err) {
      setError(
        err.response?.data?.error ||
          'Failed to save Docker Hub credentials. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {existingCredentials
              ? 'Edit Docker Hub Credentials'
              : 'Add Docker Hub Credentials'}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label htmlFor="dockerHubUsername">Docker Hub Username *</label>
            <input
              type="text"
              id="dockerHubUsername"
              name="username"
              value={formData.username}
              onChange={handleChange}
              required
              placeholder="your-dockerhub-username"
              disabled={loading}
            />
            <small>Your Docker Hub account username</small>
          </div>

          <div className="form-group">
            <label htmlFor="dockerHubToken">Personal Access Token *</label>
            <input
              type="password"
              id="dockerHubToken"
              name="token"
              value={formData.token}
              onChange={handleChange}
              required={!existingCredentials}
              placeholder={
                existingCredentials
                  ? 'Leave blank to keep current token'
                  : 'dckr_pat_...'
              }
              disabled={loading}
            />
            <small>
              {existingCredentials
                ? 'Leave blank to keep the current token, or enter a new token to update'
                : 'Create a Personal Access Token at hub.docker.com/settings/security'}
            </small>
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="modal-actions">
            <button
              type="button"
              onClick={onClose}
              className="modal-button cancel"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="modal-button submit"
              disabled={
                loading ||
                !formData.username ||
                (!formData.token && !existingCredentials)
              }
            >
              {loading
                ? 'Saving...'
                : existingCredentials
                ? 'Update Credentials'
                : 'Save Credentials'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default DockerHubCredsModal;


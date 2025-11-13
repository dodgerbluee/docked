/**
 * Docker Hub Credentials Modal
 * Popup form to add or edit Docker Hub credentials
 */

import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import axios from 'axios';
import Modal from './ui/Modal';
import Input from './ui/Input';
import Button from './ui/Button';
import Alert from './ui/Alert';
import { API_BASE_URL } from '../utils/api';
import styles from './DockerHubCredsModal.module.css';

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

  const isFormValid = () => {
    if (!formData.username.trim()) return false;
    if (!existingCredentials && !formData.token.trim()) return false;
    return true;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={existingCredentials ? 'Edit Docker Hub Credentials' : 'Add Docker Hub Credentials'}
      size="md"
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        <Input
          label="Docker Hub Username"
          name="username"
          type="text"
          value={formData.username}
          onChange={handleChange}
          required={true}
          placeholder="your-dockerhub-username"
          disabled={loading}
          helperText="Your Docker Hub account username"
        />

        <Input
          label="Personal Access Token"
          name="token"
          type="password"
          value={formData.token}
          onChange={handleChange}
          required={!existingCredentials}
          placeholder={
            existingCredentials
              ? 'Leave blank to keep current token'
              : 'dckr_pat_...'
          }
          disabled={loading}
          helperText={
            existingCredentials
              ? 'Leave blank to keep the current token, or enter a new token to update'
              : 'Create a Personal Access Token at hub.docker.com/settings/security'
          }
        />

        {error && <Alert variant="error">{error}</Alert>}

        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="outline"
            disabled={loading || !isFormValid()}
            className={styles.submitButton}
          >
            {loading
              ? 'Saving...'
              : existingCredentials
              ? 'Update Credentials'
              : 'Save Credentials'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

DockerHubCredsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func.isRequired,
  existingCredentials: PropTypes.object,
};

export default DockerHubCredsModal;

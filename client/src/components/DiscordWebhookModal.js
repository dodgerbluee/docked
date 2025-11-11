/**
 * Discord Webhook Modal
 * Popup form to add or edit Discord webhook configurations
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './AddPortainerModal.css';

// In production, API is served from same origin, so use relative URLs
const API_BASE_URL = process.env.REACT_APP_API_URL || 
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');

function DiscordWebhookModal({ isOpen, onClose, onSuccess, existingWebhook = null }) {
  const [formData, setFormData] = useState({
    webhookUrl: '',
    serverName: '',
    enabled: true,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);

  // Clear form and error when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      if (existingWebhook) {
        // Edit mode - populate with existing data (but not webhook URL for security)
        setFormData({
          webhookUrl: '', // User needs to re-enter if they want to change it
          serverName: existingWebhook.serverName || '',
          enabled: existingWebhook.enabled !== undefined ? existingWebhook.enabled : true,
        });
      } else {
        // Create mode - clear form
        setFormData({
          webhookUrl: '',
          serverName: '',
          enabled: true,
        });
      }
      setError('');
    }
  }, [isOpen, existingWebhook]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    // Clear error when user starts typing
    if (error) setError('');
  };

  const handleTestWebhook = async () => {
    setTestingWebhook(true);
    setError('');

    try {
      let webhookUrl = formData.webhookUrl.trim();
      
      // If editing and no URL provided, test the existing webhook by ID
      if (!webhookUrl && existingWebhook?.hasWebhook) {
        const response = await axios.post(
          `${API_BASE_URL}/api/discord/webhooks/${existingWebhook.id}/test`
        );
        
        if (!response.data.success) {
          throw new Error(response.data.error || 'Webhook test failed');
        }
      } else if (webhookUrl) {
        // Test with provided URL
        const response = await axios.post(
          `${API_BASE_URL}/api/discord/test`,
          {
            webhookUrl: webhookUrl,
          }
        );

        if (!response.data.success) {
          throw new Error(response.data.error || 'Webhook test failed');
        }
      } else {
        setError('Please enter a webhook URL to test');
        setTestingWebhook(false);
        return;
      }
    } catch (err) {
      setError(
        err.response?.data?.error || err.message || 'Failed to test webhook'
      );
    } finally {
      setTestingWebhook(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let webhookUrl = formData.webhookUrl.trim();
      let serverName = formData.serverName.trim() || null;

      // If webhook URL is provided and server name is missing, try to fetch webhook info
      if (webhookUrl && !serverName) {
        try {
          const infoResponse = await axios.get(`${API_BASE_URL}/api/discord/webhooks/info`, {
            params: { webhookUrl },
          });
          if (infoResponse.data.success && infoResponse.data.info) {
            const info = infoResponse.data.info;
            // Use webhook name as server name if not provided
            if (!serverName && info.name) {
              serverName = info.name;
            }
            // Note: Discord doesn't provide channel/server names via webhook API
            // Users need to enter these manually
          }
        } catch (infoError) {
          // If fetching info fails, continue anyway - it's optional
          console.debug('Could not fetch webhook info:', infoError);
        }
      }

      if (existingWebhook) {
        // For editing, webhook URL is optional (preserve existing if not provided)
        // Update existing webhook
        // Only send webhookUrl if user provided a new one
        const updateData = {
          serverName: serverName,
          enabled: formData.enabled,
        };
        
        // Only include webhookUrl if user provided a new one
        if (webhookUrl) {
          updateData.webhookUrl = webhookUrl;
        }

        const response = await axios.put(
          `${API_BASE_URL}/api/discord/webhooks/${existingWebhook.id}`,
          updateData
        );

        if (response.data.success) {
          // Clear form
          setFormData({
            webhookUrl: '',
            serverName: '',
            enabled: true,
          });
          // Call success callback
          if (onSuccess) {
            onSuccess();
          }
          // Close modal
          onClose();
        } else {
          setError(response.data.error || 'Failed to update webhook');
        }
      } else {
        // Create new webhook - webhook URL is required
        if (!webhookUrl) {
          setError('Webhook URL is required');
          setLoading(false);
          return;
        }

        const response = await axios.post(
          `${API_BASE_URL}/api/discord/webhooks`,
          {
            webhookUrl: webhookUrl,
            serverName: serverName,
            enabled: formData.enabled,
          }
        );

        if (response.data.success) {
          // Clear form
          setFormData({
            webhookUrl: '',
            serverName: '',
            enabled: true,
          });
          // Call success callback
          if (onSuccess) {
            onSuccess();
          }
          // Close modal
          onClose();
        } else {
          setError(response.data.error || 'Failed to create webhook');
        }
      }
    } catch (err) {
      setError(
        err.response?.data?.error ||
          'Failed to save webhook. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  // Debug logging
  useEffect(() => {
    console.log('DiscordWebhookModal isOpen changed:', isOpen);
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  console.log('DiscordWebhookModal rendering modal overlay');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {existingWebhook
              ? 'Edit Discord Webhook'
              : 'Add Discord Webhook'}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label htmlFor="discordWebhookUrl">
              Discord Webhook URL *
              {existingWebhook && existingWebhook.hasWebhook && (
                <span style={{ color: 'var(--dodger-blue)', marginLeft: '8px', fontSize: '0.9em' }}>
                  (Webhook is configured)
                </span>
              )}
            </label>
            <input
              type="text"
              id="discordWebhookUrl"
              name="webhookUrl"
              value={formData.webhookUrl}
              onChange={handleChange}
              required={!existingWebhook}
              placeholder="https://discord.com/api/webhooks/..."
              disabled={loading}
            />
            <small>
              {existingWebhook && existingWebhook.hasWebhook
                ? 'Enter a new webhook URL to replace the current one, or leave empty to keep the current webhook'
                : 'Create a webhook in your Discord server settings. Go to Server Settings → Integrations → Webhooks → New Webhook. Recommended: Rename the webhook to "Docked" and use the Docked logo as the avatar.'}
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="discordServerName">Server Name (Optional)</label>
            <input
              type="text"
              id="discordServerName"
              name="serverName"
              value={formData.serverName}
              onChange={handleChange}
              placeholder="My Discord Server"
              disabled={loading}
            />
            <small>
              Friendly name for the Discord server (for display only). 
              If left empty, we'll try to fetch the webhook name from Discord.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="discordWebhookEnabled" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="discordWebhookEnabled"
                name="enabled"
                checked={formData.enabled}
                onChange={handleChange}
                disabled={loading}
                style={{ width: '20px', height: '20px', cursor: 'pointer' }}
              />
              <span>Enable this webhook</span>
            </label>
            <small>When enabled, notifications will be sent to this webhook</small>
          </div>

          {(formData.webhookUrl || existingWebhook?.hasWebhook) && (
            <div className="form-group">
              <button
                type="button"
                onClick={handleTestWebhook}
                disabled={loading || testingWebhook || (!formData.webhookUrl.trim() && !existingWebhook?.hasWebhook)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                {testingWebhook ? 'Testing...' : 'Test Webhook'}
              </button>
            </div>
          )}

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
              disabled={loading || (!existingWebhook && !formData.webhookUrl.trim())}
            >
              {loading
                ? 'Saving...'
                : existingWebhook
                ? 'Update Webhook'
                : 'Add Webhook'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default DiscordWebhookModal;


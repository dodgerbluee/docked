/**
 * Discord Webhook Modal
 * Popup form to add or edit Discord webhook configurations
 */

import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import axios from "axios";
import Modal from "./ui/Modal";
import Input from "./ui/Input";
import Button from "./ui/Button";
import Alert from "./ui/Alert";
import { API_BASE_URL } from "../utils/api";
import styles from "./DiscordWebhookModal.module.css";

function DiscordWebhookModal({ isOpen, onClose, onSuccess, existingWebhook = null }) {
  const [formData, setFormData] = useState({
    webhookUrl: "",
    serverName: "",
    enabled: true,
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);

  // Clear form and error when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      if (existingWebhook) {
        // Edit mode - populate with existing data (but not webhook URL for security)
        setFormData({
          webhookUrl: "", // User needs to re-enter if they want to change it
          serverName: existingWebhook.serverName || "",
          enabled: existingWebhook.enabled !== undefined ? existingWebhook.enabled : true,
        });
      } else {
        // Create mode - clear form
        setFormData({
          webhookUrl: "",
          serverName: "",
          enabled: true,
        });
      }
      setError("");
    }
  }, [isOpen, existingWebhook]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
    // Clear error when user starts typing
    if (error) setError("");
  };

  const handleTestWebhook = async () => {
    setTestingWebhook(true);
    setError("");

    try {
      let webhookUrl = formData.webhookUrl.trim();

      // If editing and no URL provided, test the existing webhook by ID
      if (!webhookUrl && existingWebhook?.hasWebhook) {
        const response = await axios.post(
          `${API_BASE_URL}/api/discord/webhooks/${existingWebhook.id}/test`
        );

        if (!response.data.success) {
          throw new Error(response.data.error || "Webhook test failed");
        }
      } else if (webhookUrl) {
        // Test with provided URL
        const response = await axios.post(`${API_BASE_URL}/api/discord/test`, {
          webhookUrl: webhookUrl,
        });

        if (!response.data.success) {
          throw new Error(response.data.error || "Webhook test failed");
        }
      } else {
        setError("Please enter a webhook URL to test");
        setTestingWebhook(false);
        return;
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to test webhook");
    } finally {
      setTestingWebhook(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
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
          console.debug("Could not fetch webhook info:", infoError);
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
            webhookUrl: "",
            serverName: "",
            enabled: true,
          });
          // Call success callback
          if (onSuccess) {
            onSuccess();
          }
          // Close modal
          onClose();
        } else {
          setError(response.data.error || "Failed to update webhook");
        }
      } else {
        // Create new webhook - webhook URL is required
        if (!webhookUrl) {
          setError("Webhook URL is required");
          setLoading(false);
          return;
        }

        const response = await axios.post(`${API_BASE_URL}/api/discord/webhooks`, {
          webhookUrl: webhookUrl,
          serverName: serverName,
          enabled: formData.enabled,
        });

        if (response.data.success) {
          // Clear form
          setFormData({
            webhookUrl: "",
            serverName: "",
            enabled: true,
          });
          // Call success callback
          if (onSuccess) {
            onSuccess();
          }
          // Close modal
          onClose();
        } else {
          setError(response.data.error || "Failed to create webhook");
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save webhook. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const isFormValid = () => {
    if (existingWebhook) {
      // For editing, webhook URL is optional
      return true;
    }
    // For creating, webhook URL is required
    return !!formData.webhookUrl.trim();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={existingWebhook ? "Edit Discord Webhook" : "Add Discord Webhook"}
      size="md"
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.formGroup}>
          <label htmlFor="discordWebhookUrl" className={styles.label}>
            Discord Webhook URL {existingWebhook ? "" : "*"}
            {existingWebhook && existingWebhook.hasWebhook && (
              <span className={styles.webhookConfigured}>(Webhook is configured)</span>
            )}
          </label>
          <input
            id="discordWebhookUrl"
            name="webhookUrl"
            type="text"
            value={formData.webhookUrl}
            onChange={handleChange}
            required={!existingWebhook}
            placeholder="https://discord.com/api/webhooks/..."
            disabled={loading}
            className={styles.input}
          />
          <small className={styles.helperText}>
            {existingWebhook && existingWebhook.hasWebhook
              ? "Enter a new webhook URL to replace the current one, or leave empty to keep the current webhook"
              : 'Create a webhook in your Discord server settings. Go to Server Settings → Integrations → Webhooks → New Webhook. Recommended: Rename the webhook to "Docked" and use the Docked logo as the avatar.'}
          </small>
        </div>

        <Input
          label="Server Name (Optional)"
          name="serverName"
          type="text"
          value={formData.serverName}
          onChange={handleChange}
          placeholder="My Discord Server"
          disabled={loading}
          helperText="Friendly name for the Discord server (for display only). If left empty, we'll try to fetch the webhook name from Discord."
        />

        <div className={styles.formGroup}>
          <label htmlFor="discordWebhookEnabled" className={styles.checkboxLabel}>
            <input
              type="checkbox"
              id="discordWebhookEnabled"
              name="enabled"
              checked={formData.enabled}
              onChange={handleChange}
              disabled={loading}
              className={styles.checkbox}
            />
            <span>Enable this webhook</span>
          </label>
          <small className={styles.helperText}>
            When enabled, notifications will be sent to this webhook
          </small>
        </div>

        {(formData.webhookUrl || existingWebhook?.hasWebhook) && (
          <div className={styles.testButtonContainer}>
            <Button
              type="button"
              variant="secondary"
              onClick={handleTestWebhook}
              disabled={
                loading ||
                testingWebhook ||
                (!formData.webhookUrl.trim() && !existingWebhook?.hasWebhook)
              }
              size="sm"
            >
              {testingWebhook ? "Testing..." : "Test Webhook"}
            </Button>
          </div>
        )}

        {error && <Alert variant="error">{error}</Alert>}

        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="outline"
            disabled={loading || !isFormValid()}
            className={styles.submitButton}
          >
            {loading ? "Saving..." : existingWebhook ? "Update Webhook" : "Add Webhook"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

DiscordWebhookModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func.isRequired,
  existingWebhook: PropTypes.object,
};

export default DiscordWebhookModal;

/**
 * Add Portainer Instance Modal
 * Popup form to add a new Portainer instance
 */

import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import axios from "axios";
import { Package, Lock } from "lucide-react";
import Modal from "./ui/Modal";
import Input from "./ui/Input";
import Button from "./ui/Button";
import ToggleButton from "./ui/ToggleButton";
import Alert from "./ui/Alert";
import { API_BASE_URL } from "../utils/api";
import styles from "./AddPortainerModal.module.css";

const PROTOCOL_OPTIONS = [
  { value: "http", label: "HTTP" },
  { value: "https", label: "HTTPS" },
];

const AUTH_TYPE_OPTIONS = [
  {
    value: "apikey",
    label: "API Key",
    icon: Package,
  },
  {
    value: "password",
    label: "Username / Password",
    icon: Lock,
  },
];

function AddPortainerModal({ isOpen, onClose, onSuccess, initialData = null, instanceId = null }) {
  const [authType, setAuthType] = useState("apikey");
  const [protocol, setProtocol] = useState("https");
  const [formData, setFormData] = useState({
    name: "",
    url: "",
    username: "",
    password: "",
    apiKey: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  // Clear error and reset states when modal opens or closes
  useEffect(() => {
    if (!isOpen) {
      setError("");
      setCreating(false);
      setLoading(false);
    } else {
      setError("");
    }
  }, [isOpen]);

  // Update form data when initialData changes (for edit mode)
  useEffect(() => {
    if (initialData) {
      const initialAuthType = initialData.auth_type || "apikey";
      setAuthType(initialAuthType);

      // Extract protocol from URL if it exists
      let urlWithoutProtocol = initialData.url || "";
      let initialProtocol = "https";
      if (urlWithoutProtocol.startsWith("http://")) {
        initialProtocol = "http";
        urlWithoutProtocol = urlWithoutProtocol.replace("http://", "");
      } else if (urlWithoutProtocol.startsWith("https://")) {
        initialProtocol = "https";
        urlWithoutProtocol = urlWithoutProtocol.replace("https://", "");
      }
      setProtocol(initialProtocol);

      setFormData({
        name: initialData.name || "",
        url: urlWithoutProtocol,
        username: initialData.username || "",
        password: "", // Don't pre-fill password for security
        apiKey: "", // Don't pre-fill API key for security
      });
    } else {
      setAuthType("apikey");
      setProtocol("https");
      setFormData({ name: "", url: "", username: "", password: "", apiKey: "" });
    }
  }, [initialData, isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Prepare request data based on auth type
      // Ensure URL has protocol prefix
      const urlWithProtocol =
        formData.url.startsWith("http://") || formData.url.startsWith("https://")
          ? formData.url
          : `${protocol}://${formData.url}`;

      const requestData = {
        name: formData.name,
        url: urlWithProtocol,
        authType: authType,
      };

      if (authType === "apikey") {
        requestData.apiKey = formData.apiKey;
      } else {
        requestData.username = formData.username;
        requestData.password = formData.password;
      }

      let response;
      if (instanceId) {
        // Update existing instance (no validation needed)
        response = await axios.put(
          `${API_BASE_URL}/api/portainer/instances/${instanceId}`,
          requestData
        );

        if (response.data.success) {
          // Pass the updated instance data so the parent can refresh
          // onSuccess is async - wait for it to complete before closing
          await onSuccess({
            id: instanceId,
            ...requestData,
          });

          // Reset form and close modal only after onSuccess completes
          setFormData({ name: "", url: "", username: "", password: "", apiKey: "" });
          setAuthType("apikey");
          onClose();
        } else {
          setError(response.data.error || "Failed to update Portainer instance");
        }
      } else {
        // Create new instance - validate authentication first
        try {
          // Validate authentication before creating
          const validateData = {
            url: requestData.url,
            authType: requestData.authType,
          };

          if (authType === "apikey") {
            validateData.apiKey = requestData.apiKey;
          } else {
            validateData.username = requestData.username;
            validateData.password = requestData.password;
          }

          const validateResponse = await axios.post(
            `${API_BASE_URL}/api/portainer/instances/validate`,
            validateData
          );

          if (!validateResponse.data.success) {
            setError(validateResponse.data.error || "Authentication validation failed");
            setLoading(false);
            return;
          }

          // Authentication successful, now create the instance
          response = await axios.post(`${API_BASE_URL}/api/portainer/instances`, requestData);

          if (response.data.success) {
            // Pass instance data to onSuccess callback for new instances
            // onSuccess is async and will handle data fetching - wait for it to complete
            const instanceData = {
              name: formData.name || new URL(requestData.url).hostname,
              url: requestData.url,
              id: response.data.id,
            };

            // Set creating state to show "Creating..." button
            setCreating(true);
            setLoading(false); // Stop the initial loading state

            try {
              // Wait for onSuccess to complete (it handles data fetching and navigation)
              await onSuccess(instanceData);

              // Reset form and close modal only after onSuccess completes
              setFormData({ name: "", url: "", username: "", password: "", apiKey: "" });
              setAuthType("apikey");
              setCreating(false);
              onClose();
            } catch (err) {
              // If onSuccess fails, reset creating state and show error
              setCreating(false);
              setLoading(false);
              setError(err.message || "Failed to prepare instance. Please try again.");
            }
          } else {
            setError(response.data.error || "Failed to add Portainer instance");
          }
        } catch (validateErr) {
          // Validation failed - show error
          setError(
            validateErr.response?.data?.error ||
              "Authentication failed. Please check your credentials and try again."
          );
          setLoading(false);
          return;
        }
      }
    } catch (err) {
      setError(
        err.response?.data?.error ||
          (instanceId
            ? "Failed to update Portainer instance. Please try again."
            : "Failed to add Portainer instance. Please try again.")
      );
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    let value = e.target.value;

    // If user types a protocol in the URL field, strip it and update protocol selector
    if (e.target.name === "url") {
      if (value.startsWith("http://")) {
        value = value.replace("http://", "");
        setProtocol("http");
      } else if (value.startsWith("https://")) {
        value = value.replace("https://", "");
        setProtocol("https");
      }
    }

    setFormData({
      ...formData,
      [e.target.name]: value,
    });
  };

  const isFormValid = () => {
    if (!formData.name || !formData.name.trim()) return false;
    if (!formData.url) return false;
    if (authType === "password" && (!formData.username || (!instanceId && !formData.password)))
      return false;
    if (authType === "apikey" && !instanceId && !formData.apiKey) return false;
    return true;
  };

  // Prevent closing modal while loading or creating
  const handleClose = () => {
    if (!loading && !creating) {
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={instanceId ? "Edit Portainer Instance" : "Add Portainer Instance"}
      size="md"
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        <Input
          label="Instance Name"
          name="name"
          value={formData.name}
          onChange={handleChange}
          placeholder="e.g., Production Portainer"
          required
          disabled={loading}
        />

        <div className={styles.urlGroup}>
          <div className={styles.urlHeader}>
            <label htmlFor="url" className={styles.urlLabel}>
              Portainer URL <span className={styles.required}>*</span>
            </label>
            <ToggleButton
              options={PROTOCOL_OPTIONS}
              value={protocol}
              onChange={setProtocol}
              className={styles.protocolToggle}
            />
          </div>
          <div className={styles.urlInput}>
            <span className={styles.protocolPrefix}>{protocol}://</span>
            <input
              type="text"
              id="url"
              name="url"
              value={formData.url}
              onChange={handleChange}
              required
              placeholder="portainer.example.com:9000"
              disabled={loading}
              className={styles.urlField}
            />
          </div>
        </div>

        <div className={styles.formGroup}>
          <label className={styles.label}>
            Authentication Method <span className={styles.required}>*</span>
          </label>
          <ToggleButton
            options={AUTH_TYPE_OPTIONS}
            value={authType}
            onChange={setAuthType}
            className={styles.authToggle}
          />
        </div>

        {authType === "password" ? (
          <div className={styles.passwordFields}>
            <Input
              label="Username"
              name="username"
              type="text"
              value={formData.username}
              onChange={handleChange}
              required={authType === "password"}
              disabled={loading}
            />

            <Input
              label="Password"
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              required={authType === "password" && !instanceId}
              disabled={loading}
              placeholder={instanceId ? "Leave blank to keep current password" : ""}
              helperText={instanceId ? "Leave blank to keep the current password" : ""}
            />
          </div>
        ) : (
          <Input
            label="API Key"
            name="apiKey"
            type="password"
            value={formData.apiKey}
            onChange={handleChange}
            required={authType === "apikey" && !instanceId}
            disabled={loading}
            placeholder={
              instanceId ? "Leave blank to keep current API key" : "Enter your Portainer API key"
            }
            helperText={instanceId ? "Leave blank to keep the current API key" : ""}
          />
        )}

        {error && <Alert variant="error">{error}</Alert>}

        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={loading || creating}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="outline"
            disabled={loading || creating || !isFormValid()}
            className={styles.submitButton}
          >
            {creating
              ? "Creating..."
              : loading
                ? instanceId
                  ? "Updating..."
                  : "Adding..."
                : instanceId
                  ? "Update Instance"
                  : "Add Instance"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

AddPortainerModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func.isRequired,
  initialData: PropTypes.object,
  instanceId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
};

export default AddPortainerModal;

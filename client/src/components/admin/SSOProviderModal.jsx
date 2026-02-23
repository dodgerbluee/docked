import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import styles from "./SSOProviderModal.module.css";

const PROVIDER_TYPES = [
  { value: "authentik", label: "Authentik" },
  { value: "generic_oidc", label: "Generic OIDC" },
];

const ROLE_OPTIONS = ["Administrator", "Read Only"];

const INITIAL_FORM = {
  name: "",
  displayName: "",
  providerType: "authentik",
  clientId: "",
  clientSecret: "",
  issuerUrl: "",
  scopes: "openid,profile,email",
  autoRegister: true,
  defaultRole: "Administrator",
  enabled: true,
};

/**
 * SSOProviderModal Component
 * Modal form for creating or editing an SSO provider.
 */
function SSOProviderModal({
  isOpen,
  onClose,
  onSuccess,
  existingProvider = null,
  createProvider,
  updateProvider,
  testConnection,
}) {
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const isEdit = !!existingProvider;

  useEffect(() => {
    if (isOpen) {
      if (existingProvider) {
        setFormData({
          name: existingProvider.name,
          displayName: existingProvider.displayName,
          providerType: existingProvider.providerType,
          clientId: existingProvider.clientId,
          clientSecret: "", // Don't pre-fill secret
          issuerUrl: existingProvider.issuerUrl,
          scopes: existingProvider.scopes || "openid,profile,email",
          autoRegister: existingProvider.autoRegister,
          defaultRole: existingProvider.defaultRole,
          enabled: existingProvider.enabled,
        });
      } else {
        setFormData(INITIAL_FORM);
      }
      setError("");
      setTestResult(null);
    }
  }, [isOpen, existingProvider]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
    if (error) setError("");
    if (name === "issuerUrl") setTestResult(null);
  };

  const handleTest = async () => {
    if (!formData.issuerUrl.trim()) {
      setTestResult({ valid: false, error: "Enter an Issuer URL first" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(formData.issuerUrl.trim());
      setTestResult(result);
    } catch (err) {
      setTestResult({ valid: false, error: err.response?.data?.error || err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (
        !formData.name.trim() ||
        !formData.displayName.trim() ||
        !formData.clientId.trim() ||
        !formData.issuerUrl.trim()
      ) {
        setError("Please fill in all required fields");
        setLoading(false);
        return;
      }

      if (!isEdit && !formData.clientSecret.trim()) {
        setError("Client secret is required for new providers");
        setLoading(false);
        return;
      }

      const payload = {
        name: formData.name.trim(),
        displayName: formData.displayName.trim(),
        providerType: formData.providerType,
        clientId: formData.clientId.trim(),
        issuerUrl: formData.issuerUrl.trim(),
        scopes: formData.scopes.trim(),
        autoRegister: formData.autoRegister,
        defaultRole: formData.defaultRole,
        enabled: formData.enabled,
      };

      // Only include secret if provided
      if (formData.clientSecret.trim()) {
        payload.clientSecret = formData.clientSecret.trim();
      }

      if (isEdit) {
        await updateProvider(existingProvider.id, payload);
      } else {
        payload.clientSecret = formData.clientSecret.trim();
        await createProvider(payload);
      }

      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save provider. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? "Edit SSO Provider" : "Add SSO Provider"}
      size="lg"
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.formGroup}>
          <label htmlFor="ssoProviderName" className={styles.label}>
            Provider Name (slug) *
          </label>
          <input
            id="ssoProviderName"
            name="name"
            type="text"
            value={formData.name}
            onChange={handleChange}
            required
            disabled={loading || isEdit}
            placeholder="e.g. my-authentik"
            className={styles.input}
            pattern="[a-z0-9][a-z0-9_-]*"
          />
          <small className={styles.helperText}>
            Lowercase letters, numbers, hyphens, and underscores. Cannot be changed after creation.
          </small>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="ssoDisplayName" className={styles.label}>
            Display Name *
          </label>
          <input
            id="ssoDisplayName"
            name="displayName"
            type="text"
            value={formData.displayName}
            onChange={handleChange}
            required
            disabled={loading}
            placeholder="e.g. Company SSO"
            className={styles.input}
          />
          <small className={styles.helperText}>Shown on the login page button.</small>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="ssoProviderType" className={styles.label}>
            Provider Type *
          </label>
          <select
            id="ssoProviderType"
            name="providerType"
            value={formData.providerType}
            onChange={handleChange}
            disabled={loading}
            className={styles.select}
          >
            {PROVIDER_TYPES.map((pt) => (
              <option key={pt.value} value={pt.value}>
                {pt.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="ssoIssuerUrl" className={styles.label}>
            Issuer URL *
          </label>
          <input
            id="ssoIssuerUrl"
            name="issuerUrl"
            type="url"
            value={formData.issuerUrl}
            onChange={handleChange}
            required
            disabled={loading}
            placeholder="https://auth.example.com/application/o/my-app/"
            className={styles.input}
          />
          <div className={styles.testRow}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleTest}
              disabled={loading || testing || !formData.issuerUrl.trim()}
            >
              {testing ? "Testing..." : "Test Connection"}
            </Button>
            {testResult && testResult.valid && (
              <span className={styles.testSuccess}>
                Discovery OK - {testResult.discovery?.issuer}
              </span>
            )}
            {testResult && !testResult.valid && (
              <span className={styles.testFail}>{testResult.error}</span>
            )}
          </div>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="ssoClientId" className={styles.label}>
            Client ID *
          </label>
          <input
            id="ssoClientId"
            name="clientId"
            type="text"
            value={formData.clientId}
            onChange={handleChange}
            required
            disabled={loading}
            placeholder="OAuth client ID"
            className={styles.input}
          />
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="ssoClientSecret" className={styles.label}>
            Client Secret {isEdit ? "" : "*"}
          </label>
          <input
            id="ssoClientSecret"
            name="clientSecret"
            type="password"
            value={formData.clientSecret}
            onChange={handleChange}
            required={!isEdit}
            disabled={loading}
            placeholder={isEdit ? "Leave empty to keep unchanged" : "OAuth client secret"}
            className={styles.input}
          />
          {isEdit && (
            <small className={styles.helperText}>
              Leave empty to preserve the existing secret.
            </small>
          )}
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="ssoScopes" className={styles.label}>
            Scopes
          </label>
          <input
            id="ssoScopes"
            name="scopes"
            type="text"
            value={formData.scopes}
            onChange={handleChange}
            disabled={loading}
            placeholder="openid,profile,email"
            className={styles.input}
          />
          <small className={styles.helperText}>Comma-separated list of OAuth scopes.</small>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="ssoDefaultRole" className={styles.label}>
            Default Role
          </label>
          <select
            id="ssoDefaultRole"
            name="defaultRole"
            value={formData.defaultRole}
            onChange={handleChange}
            disabled={loading}
            className={styles.select}
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <small className={styles.helperText}>
            Role assigned to new users created via this provider.
          </small>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="ssoAutoRegister" className={styles.checkboxLabel}>
            <input
              type="checkbox"
              id="ssoAutoRegister"
              name="autoRegister"
              checked={formData.autoRegister}
              onChange={handleChange}
              disabled={loading}
              className={styles.checkbox}
            />
            <span>Auto-register new users</span>
          </label>
          <small className={styles.helperText}>
            Automatically create accounts for users who sign in for the first time.
          </small>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="ssoEnabled" className={styles.checkboxLabel}>
            <input
              type="checkbox"
              id="ssoEnabled"
              name="enabled"
              checked={formData.enabled}
              onChange={handleChange}
              disabled={loading}
              className={styles.checkbox}
            />
            <span>Enable this provider</span>
          </label>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="outline"
            disabled={loading}
            className={styles.submitButton}
          >
            {loading ? "Saving..." : isEdit ? "Update Provider" : "Add Provider"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

SSOProviderModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func.isRequired,
  existingProvider: PropTypes.object,
  createProvider: PropTypes.func.isRequired,
  updateProvider: PropTypes.func.isRequired,
  testConnection: PropTypes.func.isRequired,
};

export default SSOProviderModal;

/**
 * Add Repository Access Token Modal
 * Popup form to add or edit a repository access token (GitHub/GitLab)
 */

import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Modal from "./ui/Modal";
import Input from "./ui/Input";
import Button from "./ui/Button";
import Alert from "./ui/Alert";
import GitHubIcon from "./icons/GitHubIcon";
import GitLabIcon from "./icons/GitLabIcon";
import styles from "./AddRepositoryAccessTokenModal.module.css";

const PROVIDER_OPTIONS = [
  {
    value: "github",
    label: "GitHub",
    icon: GitHubIcon,
  },
  {
    value: "gitlab",
    label: "GitLab",
    icon: GitLabIcon,
  },
];

function AddRepositoryAccessTokenModal({
  isOpen,
  onClose,
  onSuccess,
  existingToken = null,
  loading = false,
}) {
  const [provider, setProvider] = useState(existingToken?.provider || "github");
  const [name, setName] = useState(existingToken?.name || "");
  const [accessToken, setAccessToken] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (existingToken) {
      setProvider(existingToken.provider);
      setName(existingToken.name || "");
      // Don't pre-fill token for security
      setAccessToken("");
    } else {
      setProvider("github");
      setName("");
      setAccessToken("");
    }
    setError("");
  }, [existingToken, isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // Validate name is required
    if (!name || name.trim().length === 0) {
      setError("Token name is required");
      return;
    }

    // Only require token if creating new token (not editing)
    if (!existingToken && (!accessToken || accessToken.trim().length === 0)) {
      setError("Access token is required");
      return;
    }

    if (onSuccess) {
      // Pass empty string if token is blank when editing (to keep existing)
      const tokenToSave = accessToken.trim() || "";
      const result = await onSuccess(provider, name.trim(), tokenToSave, existingToken?.id);
      if (result && result.success) {
        // Reset form and close modal
        setName("");
        setAccessToken("");
        setError("");
        onClose();
      } else if (result && result.error) {
        setError(result.error);
      }
    }
  };

  const handleClose = () => {
    if (!loading) {
      setError("");
      setName("");
      setAccessToken("");
      onClose();
    }
  };

  const isFormValid = () => {
    // Name is always required
    if (!name || name.trim().length === 0) {
      return false;
    }
    // When editing, token is optional (can leave blank to keep existing)
    // When creating, token is required
    if (existingToken) {
      return provider;
    }
    return provider && accessToken && accessToken.trim().length > 0;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={existingToken ? "Edit Access Token" : "Add Access Token"}
      size="md"
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.formGroup}>
          <label className={styles.label}>
            Provider <span className={styles.required}>*</span>
          </label>
          <div className={styles.providerOptions}>
            {PROVIDER_OPTIONS.map((option) => {
              const IconComponent = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`${styles.providerButton} ${
                    provider === option.value ? styles.active : ""
                  }`}
                  onClick={() => setProvider(option.value)}
                  disabled={loading || !!existingToken}
                >
                  <span className={styles.providerIcon}>
                    <IconComponent size={20} />
                  </span>
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
          {existingToken && (
            <small className={styles.helperText}>Provider cannot be changed when editing</small>
          )}
        </div>

        <Input
          label="Token Name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="e.g., Production Token, Personal Token"
          disabled={loading}
          helperText="A unique name to identify this token"
        />

        <Input
          label="Access Token"
          type="password"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          required={!existingToken}
          placeholder={
            existingToken
              ? "Enter new token to update (leave blank to keep current)"
              : "Enter your access token"
          }
          disabled={loading}
          helperText={
            existingToken
              ? "Enter a new token to update, or leave blank to keep current token"
              : provider === "github"
                ? "Create a Personal Access Token at github.com/settings/tokens"
                : "Create a Personal Access Token in your GitLab account settings"
          }
        />

        {error && <Alert variant="error">{error}</Alert>}

        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="outline"
            disabled={loading || !isFormValid()}
            className={styles.submitButton}
          >
            {loading ? "Saving..." : existingToken ? "Update Token" : "Save Token"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

AddRepositoryAccessTokenModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func.isRequired,
  existingToken: PropTypes.object,
  loading: PropTypes.bool,
};

export default AddRepositoryAccessTokenModal;

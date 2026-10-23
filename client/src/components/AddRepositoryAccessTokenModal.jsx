/**
 * Add Repository Access Token Modal
 * Popup form to add or replace a repository access token (GitHub/GitLab).
 *
 * The API keeps exactly one token per provider and replaces it wholesale, so
 * there is no rename and no "leave blank to keep the current value": a blank
 * submission would erase the saved credential. The token is therefore required,
 * and the provider cannot be switched while editing one that already exists.
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import Modal from "./ui/Modal";
import Input from "./ui/Input";
import Button from "./ui/Button";
import Alert from "./ui/Alert";
import { getProviderIcon } from "../utils/providerHelpers";
import styles from "./AddRepositoryAccessTokenModal.module.css";

const PROVIDER_OPTIONS = [
  {
    value: "github",
    label: "GitHub",
  },
  {
    value: "gitlab",
    label: "GitLab",
  },
];

const AddRepositoryAccessTokenModal = React.memo(function AddRepositoryAccessTokenModal({
  isOpen,
  onClose,
  onSuccess,
  existingToken = null,
  loading = false,
}) {
  const [provider, setProvider] = useState(existingToken?.provider || "github");
  const [accessToken, setAccessToken] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      // The stored token is never shown, so the field always starts blank -
      // and a blank submission is rejected rather than replacing the saved
      // credential with an empty one.
      setProvider(existingToken ? existingToken.provider : "github");
      setAccessToken("");
      setError("");
    }
  }, [existingToken, isOpen]);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setError("");

      const token = accessToken.trim();
      if (!token) {
        setError(
          existingToken
            ? "Enter a new access token - saving a blank value would remove the stored one."
            : "Access token is required"
        );
        return;
      }

      if (!onSuccess) return;
      try {
        const result = await onSuccess(provider, token);
        if (result && result.error) {
          setError(result.error);
          return;
        }
        setAccessToken("");
        onClose();
      } catch (err) {
        setError(err.message || "Failed to save token");
      }
    },
    [accessToken, existingToken, provider, onSuccess, onClose]
  );

  const handleClose = useCallback(() => {
    if (!loading) {
      setError("");
      setAccessToken("");
      onClose();
    }
  }, [loading, onClose]);

  const isFormValid = useMemo(() => {
    return provider && accessToken.trim().length > 0;
  }, [provider, accessToken]);

  const handleProviderChange = useCallback((newProvider) => {
    setProvider(newProvider);
  }, []);

  const handleTokenChange = useCallback((e) => {
    setAccessToken(e.target.value);
  }, []);

  const providerOptionsWithIcons = useMemo(
    () =>
      PROVIDER_OPTIONS.map((option) => ({
        ...option,
        icon: getProviderIcon(option.value),
      })),
    []
  );

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
            {providerOptionsWithIcons.map((option) => {
              const IconComponent = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`${styles.providerButton} ${
                    provider === option.value ? styles.active : ""
                  }`}
                  onClick={() => handleProviderChange(option.value)}
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
          label="Access Token"
          type="password"
          value={accessToken}
          onChange={handleTokenChange}
          required
          placeholder={existingToken ? "Enter the new access token" : "Enter your access token"}
          disabled={loading}
          helperText={
            existingToken
              ? "Replaces the stored token. The current value is never shown."
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
            disabled={loading || !isFormValid}
            className={styles.submitButton}
          >
            {loading ? "Saving..." : existingToken ? "Update Token" : "Save Token"}
          </Button>
        </div>
      </form>
    </Modal>
  );
});

AddRepositoryAccessTokenModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func.isRequired,
  existingToken: PropTypes.object,
  loading: PropTypes.bool,
};

export default AddRepositoryAccessTokenModal;

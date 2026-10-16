import React, { useState } from "react";
import PropTypes from "prop-types";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import { graphqlClient } from "../../graphql/client";
import { SET_USER_PASSWORD_MUTATION } from "../../graphql/queries";
import styles from "./ChangePasswordModal.module.css";

/**
 * ChangePasswordModal Component
 * Allows admin to change a user's password
 */
const ChangePasswordModal = ({ isOpen, onClose, userId, username, onPasswordUpdated }) => {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleClose = () => {
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!newPassword) {
      setError("New password is required");
      return;
    }

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters long");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setSaving(true);

    try {
      const result = await graphqlClient
        .mutation(SET_USER_PASSWORD_MUTATION, { userId, newPassword })
        .toPromise();

      if (!result.error && result.data?.setUserPassword?.success) {
        handleClose();
        if (onPasswordUpdated) {
          onPasswordUpdated();
        }
      } else {
        setError(
          result.error?.message ||
            result.data?.setUserPassword?.message ||
            "Failed to update password"
        );
      }
    } catch (err) {
      console.error("Error updating password:", err);
      setError(err.message || "Failed to update password. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Change Password for ${username}`}
      size="sm"
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        {error && <Alert variant="error">{error}</Alert>}

        <div className={styles.formGroup}>
          <label htmlFor="newPassword" className={styles.label}>
            New Password
          </label>
          <input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Enter new password"
            disabled={saving}
            required
            minLength={6}
            className={styles.input}
          />
          <small className={styles.helperText}>Password must be at least 6 characters long</small>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="confirmPassword" className={styles.label}>
            Confirm New Password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            disabled={saving}
            required
            minLength={6}
            className={styles.input}
          />
        </div>

        <div className={styles.formActions}>
          <Button type="button" variant="outline" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving..." : "Save Password"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

ChangePasswordModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  userId: PropTypes.number.isRequired,
  username: PropTypes.string.isRequired,
  onPasswordUpdated: PropTypes.func,
};

export default ChangePasswordModal;

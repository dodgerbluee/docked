import React from "react";
import PropTypes from "prop-types";
import Input from "../ui/Input";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import styles from "./PasswordTab.module.css";

/**
 * PasswordTab Component
 * Handles password updates
 */
const PasswordTab = React.memo(function PasswordTab({
  currentPassword,
  setCurrentPassword,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  passwordError,
  passwordSuccess,
  passwordLoading,
  handlePasswordSubmit,
}) {
  return (
    <div className={styles.updateSection}>
      <h3 className={styles.title}>Change Password</h3>
      {passwordSuccess && <Alert variant="info">{passwordSuccess}</Alert>}
      {passwordError && <Alert variant="error">{passwordError}</Alert>}
      <form onSubmit={handlePasswordSubmit} className={styles.form}>
        <Input
          id="currentPassword"
          label="Current Password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          autoComplete="current-password"
          disabled={passwordLoading}
        />
        <Input
          id="newPassword"
          label="New Password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          autoComplete="new-password"
          disabled={passwordLoading}
          minLength={6}
          helperText="Must be at least 6 characters long"
        />
        <Input
          id="confirmPassword"
          label="Confirm New Password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          autoComplete="new-password"
          disabled={passwordLoading}
          minLength={6}
        />
        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            disabled={
              passwordLoading ||
              !newPassword ||
              !confirmPassword ||
              !currentPassword
            }
            className={styles.submitButton}
          >
            {passwordLoading ? "Updating..." : "Update Password"}
          </Button>
        </div>
      </form>
    </div>
  );
});

PasswordTab.propTypes = {
  currentPassword: PropTypes.string.isRequired,
  setCurrentPassword: PropTypes.func.isRequired,
  newPassword: PropTypes.string.isRequired,
  setNewPassword: PropTypes.func.isRequired,
  confirmPassword: PropTypes.string.isRequired,
  setConfirmPassword: PropTypes.func.isRequired,
  passwordError: PropTypes.string,
  passwordSuccess: PropTypes.string,
  passwordLoading: PropTypes.bool.isRequired,
  handlePasswordSubmit: PropTypes.func.isRequired,
};

export default PasswordTab;

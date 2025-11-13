import React from "react";
import PropTypes from "prop-types";
import Input from "../ui/Input";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import styles from "./UsernameTab.module.css";

/**
 * UsernameTab Component
 * Handles username updates
 */
const UsernameTab = React.memo(function UsernameTab({
  newUsername,
  setNewUsername,
  usernamePassword,
  setUsernamePassword,
  usernameError,
  usernameSuccess,
  usernameLoading,
  handleUsernameSubmit,
}) {
  return (
    <div className={styles.updateSection}>
      <h3 className={styles.title}>Change Username</h3>
      {usernameSuccess && <Alert variant="info">{usernameSuccess}</Alert>}
      {usernameError && <Alert variant="error">{usernameError}</Alert>}
      <form onSubmit={handleUsernameSubmit} className={styles.form}>
        <Input
          id="newUsername"
          label="New Username"
          type="text"
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          required
          autoComplete="username"
          disabled={usernameLoading}
          minLength={3}
          helperText="Must be at least 3 characters long"
        />
        <Input
          id="usernamePassword"
          label="Current Password"
          type="password"
          value={usernamePassword}
          onChange={(e) => setUsernamePassword(e.target.value)}
          required
          autoComplete="current-password"
          disabled={usernameLoading}
          helperText="Enter your current password to confirm"
        />
        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            disabled={usernameLoading || !newUsername || !usernamePassword}
            className={styles.submitButton}
          >
            {usernameLoading ? "Updating..." : "Update Username"}
          </Button>
        </div>
      </form>
    </div>
  );
});

UsernameTab.propTypes = {
  newUsername: PropTypes.string.isRequired,
  setNewUsername: PropTypes.func.isRequired,
  usernamePassword: PropTypes.string.isRequired,
  setUsernamePassword: PropTypes.func.isRequired,
  usernameError: PropTypes.string,
  usernameSuccess: PropTypes.string,
  usernameLoading: PropTypes.bool.isRequired,
  handleUsernameSubmit: PropTypes.func.isRequired,
};

export default UsernameTab;


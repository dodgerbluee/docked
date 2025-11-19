/**
 * Username section component
 */

import React from "react";
import PropTypes from "prop-types";
import { User, ChevronRight, ChevronDown } from "lucide-react";
import Button from "../../../ui/Button";
import Alert from "../../../ui/Alert";
import Input from "../../../ui/Input";
import styles from "../../UserDetailsTab.module.css";

/**
 * Username section component
 * @param {Object} props
 * @param {boolean} props.isExpanded - Whether section is expanded
 * @param {Function} props.onToggle - Toggle expansion handler
 * @param {string} props.newUsername - New username value
 * @param {Function} props.setNewUsername - Set new username handler
 * @param {string} props.usernamePassword - Username password value
 * @param {Function} props.setUsernamePassword - Set username password handler
 * @param {string} props.usernameError - Username error message
 * @param {string} props.usernameSuccess - Username success message
 * @param {boolean} props.usernameLoading - Username loading state
 * @param {Function} props.handleUsernameSubmit - Username submit handler
 */
const UsernameSection = ({
  isExpanded,
  onToggle,
  newUsername,
  setNewUsername,
  usernamePassword,
  setUsernamePassword,
  usernameError,
  usernameSuccess,
  usernameLoading,
  handleUsernameSubmit,
}) => {
  return (
    <div className={styles.section}>
      <button type="button" className={styles.sectionHeader} onClick={onToggle}>
        <div className={styles.sectionHeaderContent}>
          <User size={20} className={styles.sectionIcon} />
          <h4 className={styles.sectionTitle}>Change Username</h4>
        </div>
        {isExpanded ? (
          <ChevronDown size={20} className={styles.chevron} />
        ) : (
          <ChevronRight size={20} className={styles.chevron} />
        )}
      </button>
      {isExpanded && (
        <div className={styles.sectionContent}>
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
      )}
    </div>
  );
};

UsernameSection.propTypes = {
  isExpanded: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
  newUsername: PropTypes.string.isRequired,
  setNewUsername: PropTypes.func.isRequired,
  usernamePassword: PropTypes.string.isRequired,
  setUsernamePassword: PropTypes.func.isRequired,
  usernameError: PropTypes.string,
  usernameSuccess: PropTypes.string,
  usernameLoading: PropTypes.bool.isRequired,
  handleUsernameSubmit: PropTypes.func.isRequired,
};

export default UsernameSection;


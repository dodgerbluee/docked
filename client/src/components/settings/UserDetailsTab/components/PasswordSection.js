/**
 * Password section component
 */

import React from "react";
import PropTypes from "prop-types";
import { Lock, ChevronRight, ChevronDown } from "lucide-react";
import Button from "../../../ui/Button";
import Alert from "../../../ui/Alert";
import Input from "../../../ui/Input";
import styles from "../../UserDetailsTab.module.css";

/**
 * Password section component
 * @param {Object} props
 * @param {boolean} props.isExpanded - Whether section is expanded
 * @param {Function} props.onToggle - Toggle expansion handler
 * @param {string} props.currentPassword - Current password value
 * @param {Function} props.setCurrentPassword - Set current password handler
 * @param {string} props.newPassword - New password value
 * @param {Function} props.setNewPassword - Set new password handler
 * @param {string} props.confirmPassword - Confirm password value
 * @param {Function} props.setConfirmPassword - Set confirm password handler
 * @param {string} props.passwordError - Password error message
 * @param {string} props.passwordSuccess - Password success message
 * @param {boolean} props.passwordLoading - Password loading state
 * @param {Function} props.handlePasswordSubmit - Password submit handler
 */
const PasswordSection = ({
  isExpanded,
  onToggle,
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
}) => {
  return (
    <div className={styles.section}>
      <button type="button" className={styles.sectionHeader} onClick={onToggle}>
        <div className={styles.sectionHeaderContent}>
          <Lock size={20} className={styles.sectionIcon} />
          <h4 className={styles.sectionTitle}>Change Password</h4>
        </div>
        {isExpanded ? (
          <ChevronDown size={20} className={styles.chevron} />
        ) : (
          <ChevronRight size={20} className={styles.chevron} />
        )}
      </button>
      {isExpanded && (
        <div className={styles.sectionContent}>
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
      )}
    </div>
  );
};

PasswordSection.propTypes = {
  isExpanded: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
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

export default PasswordSection;

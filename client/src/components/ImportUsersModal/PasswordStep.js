import React, { useState } from "react";
import PropTypes from "prop-types";
import Input from "../ui/Input";
import { Lock } from "lucide-react";
import styles from "../ImportUsersModal.module.css";

/**
 * PasswordStep Component
 * Step component for setting password for imported user
 */
function PasswordStep({ username, password, onPasswordChange, errors }) {
  const [confirmPassword, setConfirmPassword] = useState("");

  const handlePasswordChange = (e) => {
    onPasswordChange(e.target.value);
  };

  const handleConfirmPasswordChange = (e) => {
    setConfirmPassword(e.target.value);
  };

  return (
    <div className={styles.stepContent}>
      <div className={styles.stepHeader}>
        <Lock size={24} className={styles.stepIcon} />
        <h3 className={styles.stepTitle}>Set Password</h3>
      </div>
      <p className={styles.stepDescription}>
        Set a password for user <strong>{username}</strong>. This password is required for user
        creation.
      </p>

      <div className={styles.formGroup}>
        <label className={styles.label}>Password</label>
        <Input
          type="password"
          value={password || ""}
          onChange={handlePasswordChange}
          placeholder="Enter password (minimum 8 characters)"
          error={errors.password}
        />
        <small className={styles.helperText}>Password must be at least 8 characters long.</small>
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label}>Confirm Password</label>
        <Input
          type="password"
          value={confirmPassword}
          onChange={handleConfirmPasswordChange}
          placeholder="Confirm password"
          error={
            confirmPassword && password !== confirmPassword
              ? "Passwords do not match"
              : errors.confirmPassword
          }
        />
      </div>
    </div>
  );
}

PasswordStep.propTypes = {
  username: PropTypes.string.isRequired,
  password: PropTypes.string,
  onPasswordChange: PropTypes.func.isRequired,
  errors: PropTypes.object,
};

export default PasswordStep;

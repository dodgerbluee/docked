/**
 * User form step component
 */

import React from "react";
import PropTypes from "prop-types";
import Input from "../../ui/Input";
import Button from "../../ui/Button";
import Alert from "../../ui/Alert";
import styles from "../../CreateUserModal.module.css";

/**
 * User form step component
 * @param {Object} props
 * @param {Object} props.formData - Form data object
 * @param {Function} props.onChange - Field change handler
 * @param {Function} props.onSubmit - Form submit handler
 * @param {Function} props.onBack - Back button handler
 * @param {Function} props.onCancel - Cancel button handler
 * @param {boolean} props.loading - Loading state
 * @param {string} props.error - Error message
 * @param {boolean} props.requiresCode - Whether registration code is required
 * @param {string} props.currentStep - Current step
 */
const UserFormStep = ({
  formData,
  onChange,
  onSubmit,
  onBack,
  onCancel,
  loading,
  error,
  requiresCode,
  currentStep,
}) => {
  return (
    <form onSubmit={onSubmit} className={styles.form} noValidate>
      {error && (
        <Alert variant="error" className={styles.alert}>
          {error}
        </Alert>
      )}

      <div className={styles.formFields}>
        <Input
          id="username"
          label="Username"
          type="text"
          value={formData.username}
          onChange={onChange("username")}
          required
          autoComplete="username"
          disabled={loading}
          minLength={3}
          helperText="Must be at least 3 characters long"
          autoFocus
          className={styles.formField}
        />

        <Input
          id="email"
          label="Email"
          type="email"
          value={formData.email}
          onChange={onChange("email")}
          autoComplete="email"
          disabled={loading}
          helperText="Optional"
          className={styles.formField}
        />

        <Input
          id="password"
          label="Password"
          type="password"
          value={formData.password}
          onChange={onChange("password")}
          required
          autoComplete="new-password"
          disabled={loading}
          minLength={8}
          helperText="Must be at least 8 characters long"
          className={styles.formField}
        />

        <Input
          id="confirmPassword"
          label="Confirm Password"
          type="password"
          value={formData.confirmPassword}
          onChange={onChange("confirmPassword")}
          required
          autoComplete="new-password"
          disabled={loading}
          helperText="Must match password"
          className={styles.formField}
        />
      </div>

      <div className={styles.actions}>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            if (requiresCode && currentStep === "user_form") {
              onBack();
            } else {
              onCancel();
            }
          }}
          disabled={loading}
          className={styles.cancelButton}
        >
          {requiresCode && currentStep === "user_form" ? "Back" : "Cancel"}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={
            loading ||
            !formData.username ||
            !formData.password ||
            !formData.confirmPassword
          }
          className={styles.submitButton}
        >
          {loading ? "Creating..." : "Create User"}
        </Button>
      </div>
    </form>
  );
};

UserFormStep.propTypes = {
  formData: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  onBack: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  loading: PropTypes.bool.isRequired,
  error: PropTypes.string,
  requiresCode: PropTypes.bool.isRequired,
  currentStep: PropTypes.string.isRequired,
};

export default UserFormStep;


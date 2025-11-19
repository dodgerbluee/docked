/**
 * Create User Modal
 * Modal for creating a new user account
 * Multi-step flow: Registration code verification (if first user) -> Username/password form
 */

import React, { useState } from "react";
import PropTypes from "prop-types";
import axios from "axios";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import Alert from "./ui/Alert";
import RegistrationCodeStep from "./CreateUserModal/RegistrationCodeStep";
import UserFormStep from "./CreateUserModal/components/UserFormStep";
import { API_BASE_URL } from "../utils/api";
import {
  validateUsername,
  validatePassword,
  validatePasswordMatch,
  validateEmail,
} from "../utils/validation";
import { getErrorMessage } from "../utils/errorHandling";
import { useRegistrationCode } from "./CreateUserModal/hooks/useRegistrationCode";
import { useCreateUserFlow } from "./CreateUserModal/hooks/useCreateUserFlow";
import styles from "./CreateUserModal.module.css";

function CreateUserModal({ isOpen, onClose, onSuccess }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Use extracted hooks
  const {
    requiresCode,
    checkingCode,
    codeGenerated,
    generating,
    regenerating,
    verifying,
    verified,
    handleGenerateCode,
    handleRegenerateCode,
    handleVerifyCode,
  } = useRegistrationCode(isOpen);

  const {
    currentStep,
    formData,
    handleChange,
    handleRegistrationCodeChange,
    goToNextStep,
    goToPreviousStep,
    STEP_TYPES,
  } = useCreateUserFlow(isOpen, requiresCode);

  // Clear error when user starts typing
  const handleFieldChange = (field) => (e) => {
    handleChange(field)(e);
    if (error) {
      setError("");
    }
  };

  const validateForm = () => {
    // Validate username
    const usernameError = validateUsername(formData.username);
    if (usernameError) {
      setError(usernameError);
      return false;
    }

    // Validate password
    const passwordError = validatePassword(formData.password);
    if (passwordError) {
      setError(passwordError);
      return false;
    }

    // Validate password match
    const passwordMatchError = validatePasswordMatch(formData.password, formData.confirmPassword);
    if (passwordMatchError) {
      setError(passwordMatchError);
      return false;
    }

    // Validate email (optional)
    if (formData.email && formData.email.trim() !== "") {
      const emailError = validateEmail(formData.email);
      if (emailError) {
        setError(emailError);
        return false;
      }
    }

    return true;
  };

  // Handle generate code with error handling
  const handleGenerate = async () => {
    setError("");
    const result = await handleGenerateCode();
    if (!result.success) {
      setError(result.error);
    }
  };

  // Handle regenerate code with error handling
  const handleRegenerate = async () => {
    setError("");
    const result = await handleRegenerateCode();
    if (!result.success) {
      setError(result.error);
    } else {
      // Clear registration code field when regenerating
      handleRegistrationCodeChange("");
    }
  };

  // Handle next button (for registration code step)
  const handleNext = async () => {
    if (currentStep === STEP_TYPES.REGISTRATION_CODE) {
      setError("");
      const result = await handleVerifyCode(formData.registrationCode);
      
      if (result.success) {
        goToNextStep();
        setError("");
      } else {
        setError(result.error);
      }
    }
  };

  // Handle registration code change with error clearing
  const handleCodeChange = (value) => {
    handleRegistrationCodeChange(value);
    setError("");
  };

  // Handle form submission (for user form step)
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      // Create a completely clean axios instance for registration
      const registerAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: {
          "Content-Type": "application/json",
        },
      });

      // Explicitly remove any Authorization header
      delete registerAxios.defaults.headers.common["Authorization"];
      delete registerAxios.defaults.headers.Authorization;

      const requestBody = {
        username: formData.username,
        password: formData.password,
        confirmPassword: formData.confirmPassword,
        email: formData.email || null,
      };

      // Include registration code if required (remove dashes before sending)
      if (requiresCode && formData.registrationCode) {
        requestBody.registrationCode = formData.registrationCode.replace(/-/g, "");
      }

      const response = await registerAxios.post("/api/auth/register", requestBody);

      if (response.data.success) {
        if (onSuccess) {
          // Pass username to success callback for personalized message
          // onSuccess will handle closing the modal, so don't call onClose() here
          onSuccess(formData.username);
        } else {
          // If no onSuccess callback, close the modal normally
          onClose();
        }
      } else {
        setError(getErrorMessage(response.data, "Failed to create user"));
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to create user. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const renderContent = () => {
    if (checkingCode) {
      return (
        <div className={styles.checkingCode}>
          <p>Checking if registration code is required...</p>
        </div>
      );
    }

    // Registration code step
    if (currentStep === STEP_TYPES.REGISTRATION_CODE && requiresCode) {
      return (
        <div className={styles.stepContainer}>
          {error && (
            <Alert variant="error" className={styles.alert}>
              {error}
            </Alert>
          )}
          <RegistrationCodeStep
            codeGenerated={codeGenerated}
            onGenerate={handleGenerate}
            onRegenerate={handleRegenerate}
            onTokenChange={handleCodeChange}
            verifying={verifying}
            regenerating={regenerating}
            generating={generating}
            verified={verified}
          />
          <div className={styles.actions}>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={loading || verifying || generating || regenerating}
              className={styles.cancelButton}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleNext();
              }}
              disabled={loading || verifying || generating || regenerating || !formData.registrationCode}
              className={styles.submitButton}
            >
              {verifying ? "Verifying..." : "Next"}
            </Button>
          </div>
        </div>
      );
    }

    // User form step
    return (
      <UserFormStep
        formData={formData}
        onChange={handleFieldChange}
        onSubmit={handleSubmit}
        onBack={goToPreviousStep}
        onCancel={onClose}
        loading={loading}
        error={error}
        requiresCode={requiresCode}
        currentStep={currentStep}
      />
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create User Account" size="md">
      {renderContent()}
    </Modal>
  );
}

CreateUserModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};

export default CreateUserModal;

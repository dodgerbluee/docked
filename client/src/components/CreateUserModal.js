/**
 * Create User Modal
 * Modal for creating a new user account
 * Multi-step flow: Registration code verification (if first user) -> Username/password form
 */

import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import axios from "axios";
import Modal from "./ui/Modal";
import Input from "./ui/Input";
import Button from "./ui/Button";
import Alert from "./ui/Alert";
import RegistrationCodeStep from "./CreateUserModal/RegistrationCodeStep";
import { API_BASE_URL } from "../utils/api";
import {
  validateUsername,
  validatePassword,
  validatePasswordMatch,
  validateEmail,
  validateRegistrationCode,
} from "../utils/validation";
import { getErrorMessage } from "../utils/errorHandling";
import styles from "./CreateUserModal.module.css";

const STEP_TYPES = {
  REGISTRATION_CODE: "registration_code",
  USER_FORM: "user_form",
};

function CreateUserModal({ isOpen, onClose, onSuccess }) {
  const [currentStep, setCurrentStep] = useState(STEP_TYPES.REGISTRATION_CODE);
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    email: "",
    registrationCode: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [requiresCode, setRequiresCode] = useState(false);
  const [checkingCode, setCheckingCode] = useState(false);
  const [codeGenerated, setCodeGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(undefined);

  // Check if registration code is required when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({
        username: "",
        password: "",
        confirmPassword: "",
        email: "",
        registrationCode: "",
      });
      setError("");
      setCheckingCode(true);

      // Check if registration code is required
      const checkAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: {
          "Content-Type": "application/json",
        },
      });
      delete checkAxios.defaults.headers.common["Authorization"];
      delete checkAxios.defaults.headers.Authorization;

      checkAxios
        .get("/api/auth/registration-code-required")
        .then((response) => {
          if (response.data.success) {
            const needsCode = response.data.requiresCode || false;
            setRequiresCode(needsCode);
            // If no code needed, skip to user form
            if (!needsCode) {
              setCurrentStep(STEP_TYPES.USER_FORM);
            }
          }
        })
        .catch((err) => {
          // Default to false if check fails - skip to user form
          setRequiresCode(false);
          setCurrentStep(STEP_TYPES.USER_FORM);
        })
        .finally(() => {
          setCheckingCode(false);
        });
    } else {
      // When modal closes, reset all state
      setError("");
      setVerified(undefined);
      setVerifying(false);
      setFormData({
        username: "",
        password: "",
        confirmPassword: "",
        email: "",
        registrationCode: "",
      });
    }
  }, [isOpen]);

  const handleChange = (field) => (e) => {
    let value = e.target.value;

    // Format registration code: uppercase and add dashes
    if (field === "registrationCode") {
      // Remove existing dashes and convert to uppercase
      value = value.replace(/-/g, "").toUpperCase();
      // Add dashes every 4 characters
      if (value.length > 4) {
        value = value.slice(0, 4) + "-" + value.slice(4);
      }
      if (value.length > 9) {
        value = value.slice(0, 9) + "-" + value.slice(9, 13);
      }
      // Limit to 14 characters (XXXX-XXXX-XXXX)
      value = value.slice(0, 14);
    }

    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
    // Clear error when user starts typing
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

    // Validate registration code if required
    if (requiresCode) {
      const codeError = validateRegistrationCode(formData.registrationCode);
      if (codeError) {
        setError(codeError);
        return false;
      }
    }

    return true;
  };

  // Generate registration code
  const handleGenerateCode = async () => {
    setGenerating(true);
    setError("");
    
    try {
      const codeAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: { "Content-Type": "application/json" },
      });
      delete codeAxios.defaults.headers.common["Authorization"];

      const response = await codeAxios.post("/api/auth/generate-registration-code");
      
      if (response.data.success) {
        setCodeGenerated(true);
      } else {
        setError(response.data.error || "Failed to generate registration code");
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to generate registration code"));
    } finally {
      setGenerating(false);
    }
  };

  // Regenerate registration code
  const handleRegenerateCode = async () => {
    setRegenerating(true);
    setError("");
    
    try {
      const codeAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: { "Content-Type": "application/json" },
      });
      delete codeAxios.defaults.headers.common["Authorization"];

      const response = await codeAxios.post("/api/auth/generate-registration-code");
      
      if (response.data.success) {
        setCodeGenerated(true);
        setVerified(undefined);
        setFormData((prev) => ({ ...prev, registrationCode: "" }));
      } else {
        setError(response.data.error || "Failed to regenerate registration code");
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to regenerate registration code"));
    } finally {
      setRegenerating(false);
    }
  };

  // Verify registration code
  const handleVerifyCode = async () => {
    if (!formData.registrationCode || !formData.registrationCode.trim()) {
      setError("Please enter the registration code");
      setVerified(undefined); // Clear verified state
      return false;
    }

    setVerifying(true);
    setError("");
    setVerified(undefined); // Clear previous verification state

    try {
      // First validate code format
      const codeError = validateRegistrationCode(formData.registrationCode);
      if (codeError) {
        setError(codeError);
        setVerified(undefined);
        setVerifying(false);
        return false;
      }

      // Then verify code with server
      const verifyAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: { "Content-Type": "application/json" },
      });
      delete verifyAxios.defaults.headers.common["Authorization"];

      const codeToVerify = formData.registrationCode.replace(/-/g, "");

      const response = await verifyAxios.post("/api/auth/verify-registration-code", {
        registrationCode: codeToVerify,
      });

      if (response.data.success) {
        // Code is valid - proceed to next step
        setVerified(true);
        setVerifying(false);
        setError(""); // Clear any errors
        return true;
      } else {
        setError(response.data.error || "Invalid registration code. Please check the server logs for the correct code.");
        setVerified(undefined);
        setVerifying(false);
        return false;
      }
    } catch (err) {
      const errorMessage = err.response?.data?.error || err.message || "Invalid registration code. Please check the server logs for the correct code.";
      setError(errorMessage);
      setVerified(undefined);
      setVerifying(false);
      return false;
    }
  };

  // Handle next button (for registration code step)
  const handleNext = async () => {
    if (currentStep === STEP_TYPES.REGISTRATION_CODE) {
      try {
        const isValid = await handleVerifyCode();
        
        if (isValid) {
          // Move to user form step
          setCurrentStep(STEP_TYPES.USER_FORM);
          setError("");
        }
      } catch (err) {
        setError(err.message || "An error occurred during verification");
      }
      return;
    }
  };

  // Format registration code input
  const handleRegistrationCodeChange = (value) => {
    // Remove existing dashes and convert to uppercase
    let formatted = value.replace(/-/g, "").toUpperCase();
    // Add dashes every 4 characters
    if (formatted.length > 4) {
      formatted = formatted.slice(0, 4) + "-" + formatted.slice(4);
    }
    if (formatted.length > 9) {
      formatted = formatted.slice(0, 9) + "-" + formatted.slice(9, 13);
    }
    // Limit to 14 characters (XXXX-XXXX-XXXX)
    formatted = formatted.slice(0, 14);
    
    setFormData((prev) => ({
      ...prev,
      registrationCode: formatted,
    }));
    // Clear errors and verification state when user types
    setError("");
    setVerified(undefined);
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
            onGenerate={handleGenerateCode}
            onRegenerate={handleRegenerateCode}
            onTokenChange={handleRegistrationCodeChange}
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
      <form onSubmit={handleSubmit} className={styles.form}>
        {error && (
          <Alert variant="error" className={styles.alert}>
            {error}
          </Alert>
        )}

        <Input
          id="username"
          label="Username"
          type="text"
          value={formData.username}
          onChange={handleChange("username")}
          required
          autoComplete="username"
          disabled={loading}
          minLength={3}
          helperText="Must be at least 3 characters long"
          autoFocus
        />

        <Input
          id="email"
          label="Email"
          type="email"
          value={formData.email}
          onChange={handleChange("email")}
          autoComplete="email"
          disabled={loading}
          helperText="Optional"
        />

        <Input
          id="password"
          label="Password"
          type="password"
          value={formData.password}
          onChange={handleChange("password")}
          required
          autoComplete="new-password"
          disabled={loading}
          minLength={8}
          helperText="Must be at least 8 characters long"
        />

        <Input
          id="confirmPassword"
          label="Confirm Password"
          type="password"
          value={formData.confirmPassword}
          onChange={handleChange("confirmPassword")}
          required
          autoComplete="new-password"
          disabled={loading}
          helperText="Must match password"
        />

        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (requiresCode && currentStep === STEP_TYPES.USER_FORM) {
                setCurrentStep(STEP_TYPES.REGISTRATION_CODE);
              } else {
                onClose();
              }
            }}
            disabled={loading}
            className={styles.cancelButton}
          >
            {requiresCode && currentStep === STEP_TYPES.USER_FORM ? "Back" : "Cancel"}
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

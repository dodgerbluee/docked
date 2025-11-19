/**
 * Hook for managing create user flow state and navigation
 */

import { useState, useEffect } from "react";

const STEP_TYPES = {
  REGISTRATION_CODE: "registration_code",
  USER_FORM: "user_form",
};

/**
 * Hook to manage create user flow state
 * @param {boolean} isOpen - Whether modal is open
 * @param {boolean} requiresCode - Whether registration code is required
 * @returns {Object} Flow state and handlers
 */
export const useCreateUserFlow = (isOpen, requiresCode) => {
  const [currentStep, setCurrentStep] = useState(STEP_TYPES.REGISTRATION_CODE);
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    email: "",
    registrationCode: "",
  });

  // Reset form and step when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setFormData({
        username: "",
        password: "",
        confirmPassword: "",
        email: "",
        registrationCode: "",
      });
      // If no code needed, skip to user form
      if (!requiresCode) {
        setCurrentStep(STEP_TYPES.USER_FORM);
      } else {
        setCurrentStep(STEP_TYPES.REGISTRATION_CODE);
      }
    } else {
      // Reset when modal closes
      setFormData({
        username: "",
        password: "",
        confirmPassword: "",
        email: "",
        registrationCode: "",
      });
    }
  }, [isOpen, requiresCode]);

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
  };

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
  };

  const goToNextStep = () => {
    if (currentStep === STEP_TYPES.REGISTRATION_CODE) {
      setCurrentStep(STEP_TYPES.USER_FORM);
    }
  };

  const goToPreviousStep = () => {
    if (currentStep === STEP_TYPES.USER_FORM) {
      setCurrentStep(STEP_TYPES.REGISTRATION_CODE);
    }
  };

  return {
    currentStep,
    formData,
    setFormData,
    handleChange,
    handleRegistrationCodeChange,
    goToNextStep,
    goToPreviousStep,
    STEP_TYPES,
  };
};


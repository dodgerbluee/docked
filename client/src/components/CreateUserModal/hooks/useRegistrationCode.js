/**
 * Hook for managing registration code logic
 */

import { useState, useEffect } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../utils/api";
import { validateRegistrationCode } from "../../../utils/validation";
import { getErrorMessage } from "../../../utils/errorHandling";

/**
 * Hook to manage registration code state and operations
 * @param {boolean} isOpen - Whether modal is open
 * @returns {Object} Registration code state and handlers
 */
export const useRegistrationCode = (isOpen) => {
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
          }
        })
        .catch((err) => {
          // Default to false if check fails
          setRequiresCode(false);
        })
        .finally(() => {
          setCheckingCode(false);
        });
    } else {
      // Reset state when modal closes
      setVerified(undefined);
      setVerifying(false);
      setCodeGenerated(false);
    }
  }, [isOpen]);

  // Generate registration code
  const handleGenerateCode = async () => {
    setGenerating(true);
    
    try {
      const codeAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: { "Content-Type": "application/json" },
      });
      delete codeAxios.defaults.headers.common["Authorization"];

      const response = await codeAxios.post("/api/auth/generate-registration-code");
      
      if (response.data.success) {
        setCodeGenerated(true);
        return { success: true };
      } else {
        return { success: false, error: response.data.error || "Failed to generate registration code" };
      }
    } catch (err) {
      return { success: false, error: getErrorMessage(err, "Failed to generate registration code") };
    } finally {
      setGenerating(false);
    }
  };

  // Regenerate registration code
  const handleRegenerateCode = async () => {
    setRegenerating(true);
    
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
        return { success: true };
      } else {
        return { success: false, error: response.data.error || "Failed to regenerate registration code" };
      }
    } catch (err) {
      return { success: false, error: getErrorMessage(err, "Failed to regenerate registration code") };
    } finally {
      setRegenerating(false);
    }
  };

  // Verify registration code
  const handleVerifyCode = async (registrationCode) => {
    if (!registrationCode || !registrationCode.trim()) {
      setVerified(undefined);
      return { success: false, error: "Please enter the registration code" };
    }

    setVerifying(true);
    setVerified(undefined);

    try {
      // First validate code format
      const codeError = validateRegistrationCode(registrationCode);
      if (codeError) {
        setVerified(undefined);
        setVerifying(false);
        return { success: false, error: codeError };
      }

      // Then verify code with server
      const verifyAxios = axios.create({
        baseURL: API_BASE_URL,
        headers: { "Content-Type": "application/json" },
      });
      delete verifyAxios.defaults.headers.common["Authorization"];

      const codeToVerify = registrationCode.replace(/-/g, "");

      const response = await verifyAxios.post("/api/auth/verify-registration-code", {
        registrationCode: codeToVerify,
      });

      if (response.data.success) {
        setVerified(true);
        setVerifying(false);
        return { success: true };
      } else {
        const errorMessage = response.data.error || "Invalid registration code. Please check the server logs for the correct code.";
        setVerified(undefined);
        setVerifying(false);
        return { success: false, error: errorMessage };
      }
    } catch (err) {
      const errorMessage = err.response?.data?.error || err.message || "Invalid registration code. Please check the server logs for the correct code.";
      setVerified(undefined);
      setVerifying(false);
      return { success: false, error: errorMessage };
    }
  };

  return {
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
  };
};


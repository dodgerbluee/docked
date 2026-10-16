/**
 * Hook for managing registration code logic
 */

import { useState, useEffect } from "react";
import { graphqlClient } from "../../../graphql/client";
import {
  REGISTRATION_CODE_STATUS_QUERY,
  GENERATE_REGISTRATION_CODE_MUTATION,
  VERIFY_REGISTRATION_CODE_MUTATION,
} from "../../../graphql/queries";
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

      graphqlClient
        .query(REGISTRATION_CODE_STATUS_QUERY)
        .toPromise()
        .then(({ data }) => {
          setRequiresCode(data?.registrationCodeStatus?.requiresCode ?? false);
        })
        .catch(() => {
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
      const { data, error } = await graphqlClient
        .mutation(GENERATE_REGISTRATION_CODE_MUTATION)
        .toPromise();

      const result = data?.generateRegistrationCode;
      if (result?.success) {
        setCodeGenerated(true);
        return { success: true };
      }
      return {
        success: false,
        error: result?.error || error?.message || "Failed to generate registration code",
      };
    } catch (err) {
      return {
        success: false,
        error: getErrorMessage(err, "Failed to generate registration code"),
      };
    } finally {
      setGenerating(false);
    }
  };

  // Regenerate registration code
  const handleRegenerateCode = async () => {
    setRegenerating(true);

    try {
      const { data, error } = await graphqlClient
        .mutation(GENERATE_REGISTRATION_CODE_MUTATION)
        .toPromise();

      const result = data?.generateRegistrationCode;
      if (result?.success) {
        setCodeGenerated(true);
        setVerified(undefined);
        return { success: true };
      }
      return {
        success: false,
        error: result?.error || error?.message || "Failed to regenerate registration code",
      };
    } catch (err) {
      return {
        success: false,
        error: getErrorMessage(err, "Failed to regenerate registration code"),
      };
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
      const codeToVerify = registrationCode.replace(/-/g, "");

      const { data, error } = await graphqlClient
        .mutation(VERIFY_REGISTRATION_CODE_MUTATION, { code: codeToVerify })
        .toPromise();

      const result = data?.verifyRegistrationCode;
      if (result?.success) {
        setVerified(true);
        setVerifying(false);
        return { success: true };
      }
      const errorMessage =
        result?.error ||
        error?.message ||
        "Invalid registration code. Please check the server logs for the correct code.";
      setVerified(undefined);
      setVerifying(false);
      return { success: false, error: errorMessage };
    } catch (err) {
      const errorMessage =
        err.message ||
        "Invalid registration code. Please check the server logs for the correct code.";
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

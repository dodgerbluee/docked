import { useState, useEffect, useRef } from "react";

/**
 * useUserImportState Hook
 * Manages all state for the user import process
 */
export function useUserImportState(isOpen) {
  // File and data state
  const [file, setFile] = useState(null);
  const [usersData, setUsersData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  // User iteration state
  const [currentUserIndex, setCurrentUserIndex] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [importStarted, setImportStarted] = useState(false);

  // Per-user data storage
  const [userPasswords, setUserPasswords] = useState({}); // { username: password }
  const [userCredentials, setUserCredentials] = useState({}); // { username: { portainerInstances, dockerHub, discordWebhooks } }
  const [userSkippedSteps, setUserSkippedSteps] = useState({}); // { username: Set<stepType> }
  const [userStepErrors, setUserStepErrors] = useState({}); // { username: { stepType: error } }

  // Instance admin verification state
  const [verificationStatus, setVerificationStatus] = useState({}); // { username: true/false/undefined }
  const [verifying, setVerifying] = useState({}); // { username: boolean }
  const [regenerating, setRegenerating] = useState({}); // { username: boolean }
  const [generating, setGenerating] = useState({}); // { username: boolean }
  const [verificationTokens, setVerificationTokens] = useState({}); // { username: token }
  const [verificationInputTokens, setVerificationInputTokens] = useState({}); // { username: inputToken }

  // Results tracking
  const [importedUsers, setImportedUsers] = useState([]); // Array of successfully imported usernames
  const [importErrors, setImportErrors] = useState([]); // Array of error messages

  const fileInputRef = useRef(null);

  // Reset all state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      // Reset all state when modal opens
      setFile(null);
      setUsersData(null);
      setError("");
      setCurrentUserIndex(0);
      setCurrentStepIndex(0);
      setImportStarted(false);
      setUserPasswords({});
      setUserCredentials({});
      setUserSkippedSteps({});
      setUserStepErrors({});
      setVerificationStatus({});
      setVerifying({});
      setRegenerating({});
      setGenerating({});
      setVerificationTokens({});
      setVerificationInputTokens({});
      setImportedUsers([]);
      setImportErrors([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [isOpen]);

  return {
    // File and data
    file,
    setFile,
    usersData,
    setUsersData,
    error,
    setError,
    loading,
    setLoading,
    importing,
    setImporting,

    // User iteration
    currentUserIndex,
    setCurrentUserIndex,
    currentStepIndex,
    setCurrentStepIndex,
    importStarted,
    setImportStarted,

    // Per-user data
    userPasswords,
    setUserPasswords,
    userCredentials,
    setUserCredentials,
    userSkippedSteps,
    setUserSkippedSteps,
    userStepErrors,
    setUserStepErrors,

    // Verification
    verificationStatus,
    setVerificationStatus,
    verifying,
    setVerifying,
    regenerating,
    setRegenerating,
    generating,
    setGenerating,
    verificationTokens,
    setVerificationTokens,
    verificationInputTokens,
    setVerificationInputTokens,

    // Results
    importedUsers,
    setImportedUsers,
    importErrors,
    setImportErrors,

    // Refs
    fileInputRef,
  };
}

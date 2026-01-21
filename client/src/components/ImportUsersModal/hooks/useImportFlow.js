import { useCallback } from "react";
import { initializeUserCredentials, calculateUserSteps } from "../utils/credentialInitializers";
import { isInstanceAdmin } from "../utils/userImportParsers";

// Step types
const STEP_TYPES = {
  INSTANCE_ADMIN_VERIFICATION: "instance_admin_verification",
  PASSWORD: "password",
  PORTAINER: "portainer",
  DISCORD: "discord",
};

/**
 * useImportFlow Hook
 * Handles navigation logic for the import flow (next, skip, back)
 * Consolidates common logic between handleNext and handleSkip
 */
export function useImportFlow({
  currentUser,
  currentStepType,
  currentStepIndex,
  totalStepsForCurrentUser,
  currentUserIndex,
  totalUsers,
  usersData,
  userSkippedSteps,
  verificationInputTokens,
  handleVerifyToken,
  validateCurrentStep,
  validateCredentialsStep,
  createUserWithConfig,
  setLoading,
  setError,
  setUserStepErrors,
  setUserSkippedSteps,
  setCurrentStepIndex,
  setCurrentUserIndex,
  setUserCredentials,
  importedUsers,
  importErrors,
  setImportErrors,
  onSuccess,
}) {
  // Handle completion of all users
  const handleComplete = useCallback(
    (newlyImportedUsername = null) => {
      // Calculate total imported: if a user was just imported, add 1 to the current count
      // This accounts for the async state update delay where setImportedUsers hasn't updated yet
      let totalImported = importedUsers.length;
      if (newlyImportedUsername && !importedUsers.includes(newlyImportedUsername)) {
        totalImported += 1;
      }
      let message;
      if (totalImported > 0) {
        message = `Successfully imported ${totalImported} user(s)`;
      } else {
        message = `No users were imported.`;
      }
      if (importErrors.length > 0) {
        message += `. ${importErrors.length} error(s) occurred.`;
      }
      onSuccess(message);
    },
    [importedUsers, importErrors, onSuccess]
  );

  // Move to next user and initialize credentials
  // Note: Users are already filtered for existing users before import starts
  const moveToNextUser = useCallback(
    async (nextUserIndex) => {
      if (nextUserIndex >= usersData.users.length) {
        // No more users - complete
        handleComplete();
        return;
      }

      setCurrentUserIndex(nextUserIndex);
      setCurrentStepIndex(0);
      const nextUser = usersData.users[nextUserIndex];
      const credentials = initializeUserCredentials(nextUser);
      setUserCredentials((prev) => ({
        ...prev,
        [nextUser.username]: credentials,
      }));
    },
    [usersData, setCurrentUserIndex, setCurrentStepIndex, setUserCredentials, handleComplete]
  );

  // Clear step errors
  const clearStepErrors = useCallback(
    (username, stepType) => {
      setUserStepErrors((prev) => {
        const updated = { ...prev };
        if (updated[username]) {
          delete updated[username][stepType];
          if (stepType === STEP_TYPES.PORTAINER) {
            Object.keys(updated[username]).forEach((key) => {
              if (key.startsWith("portainer_")) {
                delete updated[username][key];
              }
            });
          }
        }
        return updated;
      });
    },
    [setUserStepErrors]
  );

  // Common logic for advancing to next step or user
  const advanceFlow = useCallback(
    async (skipValidation = false) => {
      if (!currentUser) return false;

      const username = currentUser.username;

      // For instance admin verification step, verify token if entered
      if (currentStepType === STEP_TYPES.INSTANCE_ADMIN_VERIFICATION) {
        const inputToken = verificationInputTokens[username];
        if (inputToken && inputToken.trim()) {
          setLoading(true);
          try {
            const verified = await handleVerifyToken(username, inputToken.trim());
            setLoading(false);
            if (!verified) {
              return false;
            }
          } catch (err) {
            setLoading(false);
            return false;
          }
        }
      }

      // Validate current step (unless skipping)
      if (!skipValidation) {
        if (!validateCurrentStep()) {
          return false;
        }

        // For credential steps, validate with backend
        if (
          [STEP_TYPES.PORTAINER, STEP_TYPES.DISCORD].includes(currentStepType)
        ) {
          setLoading(true);
          try {
            const validation = await validateCredentialsStep();
            if (!validation.success) {
              setError(validation.error || "Validation failed");
              setLoading(false);
              return false;
            }
            setError("");
          } catch (err) {
            setError(err.response?.data?.error || "Validation failed");
            setLoading(false);
            return false;
          } finally {
            setLoading(false);
          }
        }
      }

      // Clear step errors
      clearStepErrors(username, currentStepType);

      if (currentStepType === STEP_TYPES.INSTANCE_ADMIN_VERIFICATION) {
        setLoading(false);
      }

      // Move to next step
      if (currentStepIndex < totalStepsForCurrentUser - 1) {
        setCurrentStepIndex(currentStepIndex + 1);
        return true;
      } else {
        // All steps complete for this user - create user
        const result = await createUserWithConfig();

        if (result.success) {
          // Move to next user
          if (currentUserIndex < totalUsers - 1) {
            await moveToNextUser(currentUserIndex + 1);
          } else {
            // All users processed - pass username only if user was actually imported
            handleComplete(result.imported ? result.username : null);
          }
        }
        return result.success;
      }
    },
    [
      currentUser,
      currentStepType,
      currentStepIndex,
      totalStepsForCurrentUser,
      currentUserIndex,
      totalUsers,
      verificationInputTokens,
      handleVerifyToken,
      validateCurrentStep,
      validateCredentialsStep,
      createUserWithConfig,
      setLoading,
      setError,
      clearStepErrors,
      setCurrentStepIndex,
      moveToNextUser,
      handleComplete,
    ]
  );

  // Handle next step (with validation)
  const handleNext = useCallback(async () => {
    return await advanceFlow(false);
  }, [advanceFlow]);

  // Handle skip current step (without validation)
  const handleSkip = useCallback(() => {
    if (!currentUser) return;

    const username = currentUser.username;
    const skipped = new Set(userSkippedSteps[username] || []);
    skipped.add(currentStepType);
    setUserSkippedSteps((prev) => ({ ...prev, [username]: skipped }));

    // Clear step errors
    clearStepErrors(username, currentStepType);

    setError("");

    // Advance flow without validation
    advanceFlow(true).then((success) => {
      if (!success) return;

      // If we completed a user, advanceFlow already handled moving to next user or completion
      // But we need to handle the case where we're just moving to next step
      if (currentStepIndex < totalStepsForCurrentUser - 1) {
        // Already handled in advanceFlow
        return;
      }
    });
  }, [
    currentUser,
    currentStepType,
    currentStepIndex,
    totalStepsForCurrentUser,
    userSkippedSteps,
    setUserSkippedSteps,
    clearStepErrors,
    setError,
    advanceFlow,
  ]);

  // Handle back navigation
  const handleBack = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
      setError("");
    } else if (currentUserIndex > 0) {
      const prevUserIndex = currentUserIndex - 1;
      const prevUser = usersData.users[prevUserIndex];
      const isInstanceAdminUser = isInstanceAdmin(prevUser);
      const prevUserSteps = calculateUserSteps(prevUser, isInstanceAdminUser);
      setCurrentUserIndex(prevUserIndex);
      setCurrentStepIndex(prevUserSteps.length - 1);
      setError("");
    }
  }, [
    currentStepIndex,
    currentUserIndex,
    usersData,
    setCurrentStepIndex,
    setCurrentUserIndex,
    setError,
  ]);

  // Handle skip entire user (skip all remaining steps)
  const handleSkipUser = useCallback(async () => {
    if (!currentUser) return;

    const username = currentUser.username;
    // Mark all remaining steps as skipped
    const skipped = new Set(userSkippedSteps[username] || []);
    const remainingSteps = totalStepsForCurrentUser - currentStepIndex;
    for (let i = 0; i < remainingSteps; i++) {
      const stepIndex = currentStepIndex + i;
      if (stepIndex < totalStepsForCurrentUser) {
        // We can't determine step type from index alone, so we'll skip by advancing
      }
    }

    // Mark all credential steps as skipped
    skipped.add(STEP_TYPES.PORTAINER);
    skipped.add(STEP_TYPES.DISCORD);
    setUserSkippedSteps((prev) => ({ ...prev, [username]: skipped }));

    // Move to next user or complete if this is the last user
    if (currentUserIndex < totalUsers - 1) {
      await moveToNextUser(currentUserIndex + 1);
    } else {
      // This is the last user - complete the import
      handleComplete();
    }
  }, [
    currentUser,
    currentUserIndex,
    totalUsers,
    totalStepsForCurrentUser,
    currentStepIndex,
    userSkippedSteps,
    setUserSkippedSteps,
    moveToNextUser,
    handleComplete,
  ]);

  return {
    handleNext,
    handleSkip,
    handleSkipUser,
    handleBack,
  };
}

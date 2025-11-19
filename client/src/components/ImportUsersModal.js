/**
 * Import Users Modal (Refactored)
 * Modal for importing users from a JSON file with multi-step verification and credential collection
 * Refactored to use extracted hooks and components for better maintainability
 */

import React, { useMemo, useCallback, useEffect } from "react";
import PropTypes from "prop-types";
import axios from "axios";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import Alert from "./ui/Alert";
import FileUploadStep from "./ImportUsersModal/FileUploadStep";
import StepRenderer from "./ImportUsersModal/StepRenderer";
import { API_BASE_URL } from "../utils/api";
import { parseUserImportFile, isInstanceAdmin } from "./ImportUsersModal/utils/userImportParsers";
import {
  initializeUserCredentials,
  calculateUserSteps,
} from "./ImportUsersModal/utils/credentialInitializers";
import { useUserImportState } from "./ImportUsersModal/hooks/useUserImportState";
import { useInstanceAdminToken } from "./ImportUsersModal/hooks/useInstanceAdminToken";
import { useCredentialValidation } from "./ImportUsersModal/hooks/useCredentialValidation";
import { useUserCreation } from "./ImportUsersModal/hooks/useUserCreation";
import { useImportFlow } from "./ImportUsersModal/hooks/useImportFlow";
import styles from "./ImportUsersModal.module.css";

// Step types
const STEP_TYPES = {
  INSTANCE_ADMIN_VERIFICATION: "instance_admin_verification",
  PASSWORD: "password",
  PORTAINER: "portainer",
  DOCKERHUB: "dockerhub",
  DISCORD: "discord",
};

function ImportUsersModal({ isOpen, onClose, onSuccess }) {
  // Use custom hook for all state management
  const state = useUserImportState(isOpen);

  const {
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
    currentUserIndex,
    setCurrentUserIndex,
    currentStepIndex,
    setCurrentStepIndex,
    importStarted,
    setImportStarted,
    userPasswords,
    setUserPasswords,
    userCredentials,
    setUserCredentials,
    userSkippedSteps,
    setUserSkippedSteps,
    userStepErrors,
    setUserStepErrors,
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
    importedUsers,
    setImportedUsers,
    importErrors,
    setImportErrors,
    fileInputRef,
  } = state;

  // Use hooks for business logic
  const { handleGenerateToken, handleRegenerateToken, handleVerifyToken } = useInstanceAdminToken({
    setGenerating,
    setRegenerating,
    setVerifying,
    setVerificationStatus,
    setVerificationTokens,
    setUserStepErrors,
    setError,
    importedUsers,
  });

  // Calculate steps needed for current user (must be before currentStepType)
  const currentUserSteps = useMemo(() => {
    if (!usersData || currentUserIndex >= usersData.users.length) return [];

    const user = usersData.users[currentUserIndex];
    const isInstanceAdminUser = isInstanceAdmin(user);

    // Use calculateUserSteps to filter out steps that don't have data
    return calculateUserSteps(user, isInstanceAdminUser);
  }, [usersData, currentUserIndex]);

  // Calculate current step type
  const currentStepType = useMemo(() => {
    if (!usersData || currentUserIndex >= usersData.users.length) return null;
    return currentUserSteps[currentStepIndex];
  }, [usersData, currentUserIndex, currentStepIndex, currentUserSteps]);

  // Calculate these values before using them in hooks
  const currentUser = usersData?.users[currentUserIndex];
  const totalUsers = usersData?.users.length || 0;
  const totalStepsForCurrentUser = currentUserSteps.length;

  const { validateCurrentStep, validateCredentialsStep } = useCredentialValidation({
    currentUser,
    currentStepType,
    userPasswords,
    userCredentials,
    userSkippedSteps,
    setUserStepErrors,
    setError,
    setLoading,
  });

  const { createUserWithConfig } = useUserCreation({
    currentUser,
    userPasswords,
    userCredentials,
    userSkippedSteps,
    verificationStatus,
    verificationTokens,
    setImporting,
    setError,
    setImportedUsers,
    setImportErrors,
    setVerificationTokens,
  });

  // Use import flow hook for navigation logic
  const { handleNext, handleSkip, handleSkipUser, handleBack } = useImportFlow({
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
  });

  // Auto-advance if current step has no data (shouldn't happen if calculateUserSteps works correctly, but safety check)
  useEffect(() => {
    if (!importStarted || importing || loading || !currentStepType || !currentUser) return;

    // Check if current step should be skipped (no data) - this is a safety check
    const shouldSkipStep =
      (currentStepType === STEP_TYPES.PORTAINER &&
        (!currentUser.portainerInstances || currentUser.portainerInstances.length === 0)) ||
      (currentStepType === STEP_TYPES.DOCKERHUB &&
        (!currentUser.dockerHubCredentials ||
          (!currentUser.dockerHubCredentials.username &&
            !currentUser.dockerHubCredentials.token))) ||
      (currentStepType === STEP_TYPES.DISCORD &&
        (!currentUser.discordWebhooks || currentUser.discordWebhooks.length === 0));

    if (shouldSkipStep) {
      // Auto-advance to next step
      if (currentStepIndex < totalStepsForCurrentUser - 1) {
        setCurrentStepIndex(currentStepIndex + 1);
      } else {
        // Last step - advance flow (will create user or move to next user)
        handleNext();
      }
    }
  }, [
    currentStepType,
    currentUser,
    currentStepIndex,
    totalStepsForCurrentUser,
    importStarted,
    importing,
    loading,
    setCurrentStepIndex,
    handleNext,
  ]);

  // Handle file change
  const handleFileChange = useCallback(
    async (e) => {
      const selectedFile = e.target.files[0];
      if (selectedFile) {
        if (selectedFile.type !== "application/json" && !selectedFile.name.endsWith(".json")) {
          setError("Please select a JSON file");
          return;
        }
        setFile(selectedFile);
        setError("");
        setLoading(true);

        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const result = parseUserImportFile(e.target.result);
            if (result.success) {
              // Check for existing users
              const checkAxios = axios.create({
                baseURL: API_BASE_URL,
                headers: { "Content-Type": "application/json" },
              });
              delete checkAxios.defaults.headers.common["Authorization"];

              const existingUsers = [];
              const validUsers = [];
              const preImportErrors = [];

              for (const user of result.data.users) {
                if (!user || !user.username) continue;

                try {
                  const response = await checkAxios.get(`/api/auth/check-user-exists`, {
                    params: { username: user.username },
                  });

                  if (response.data.success && response.data.exists) {
                    existingUsers.push(user.username);
                    preImportErrors.push(`User "${user.username}" already exists`);
                  } else {
                    validUsers.push(user);
                  }
                } catch (err) {
                  console.warn(`Error checking if user ${user.username} exists:`, err);
                  // If check fails, include the user
                  validUsers.push(user);
                }
              }

              // Update usersData with only valid users
              const filteredUsersData = {
                ...result.data,
                users: validUsers,
              };

              // Recalculate instanceAdminUsers for filtered list
              filteredUsersData.instanceAdminUsers = validUsers.filter((user) => {
                return user.instanceAdmin !== undefined
                  ? user.instanceAdmin
                  : user.instance_admin === true || user.instance_admin === 1;
              });

              setUsersData(filteredUsersData);
              setImportErrors(preImportErrors);
            } else {
              setError(result.error);
            }
          } catch (err) {
            console.error("Error processing file:", err);
            setError("Failed to process file");
          } finally {
            setLoading(false);
          }
        };
        reader.onerror = () => {
          setError("Failed to read file");
          setLoading(false);
        };
        reader.readAsText(selectedFile);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [setFile, setError, setUsersData, setImportErrors, setLoading, fileInputRef]
  );

  const handleFileButtonClick = useCallback(() => {
    fileInputRef.current?.click();
  }, [fileInputRef]);

  // Start import process
  const handleStartImport = useCallback(async () => {
    if (!usersData) {
      setError("Please select a valid JSON file with users");
      return;
    }

    // If no users remain (all were skipped), just show success message
    if (usersData.users.length === 0) {
      const message =
        importErrors.length > 0
          ? `No users were imported. ${importErrors.length} user(s) already exist.`
          : "No users to import.";
      onSuccess(message);
      return;
    }

    setImportStarted(true);
    setError("");
    // Clear pre-import errors (they're already shown in the file upload step)
    setImportErrors([]);

    // Set the first user (users have already been filtered)
    setCurrentUserIndex(0);
    setCurrentStepIndex(0);
    const firstUser = usersData.users[0];
    const credentials = initializeUserCredentials(firstUser);
    setUserCredentials((prev) => ({
      ...prev,
      [firstUser.username]: credentials,
    }));
  }, [
    usersData,
    setImportStarted,
    setCurrentUserIndex,
    setCurrentStepIndex,
    setError,
    setUserCredentials,
    setImportErrors,
    importErrors,
    onSuccess,
  ]);

  // Update password for current user
  const handlePasswordChange = useCallback(
    (password) => {
      if (!currentUser) return;
      setUserPasswords((prev) => ({ ...prev, [currentUser.username]: password }));
      setUserStepErrors((prev) => {
        const updated = { ...prev };
        if (updated[currentUser.username]) {
          delete updated[currentUser.username].password;
        }
        return updated;
      });
    },
    [currentUser, setUserPasswords, setUserStepErrors]
  );

  // Update credential for current user (generic)
  const handleCredentialUpdate = useCallback(
    (updateFn) => {
      if (!currentUser) return;
      const username = currentUser.username;
      setUserCredentials((prev) => {
        const userCreds = prev[username] || {};
        const updated = updateFn(userCreds);
        return { ...prev, [username]: updated };
      });
      setUserStepErrors((prev) => {
        const updated = { ...prev };
        if (updated[username]) {
          Object.keys(updated[username]).forEach((key) => {
            if (key.startsWith(currentStepType)) {
              delete updated[username][key];
            }
          });
        }
        return updated;
      });
    },
    [currentUser, currentStepType, setUserCredentials, setUserStepErrors]
  );

  // Update credential for current user (wrapper for Portainer step)
  const handlePortainerCredentialUpdate = useCallback(
    (index, field, value) => {
      if (!currentUser) return;
      const instances = currentUser.portainerInstances || [];
      handleCredentialUpdate((prev) => {
        const portainer = prev.portainerInstances || [];
        const updated = [...portainer];
        if (!updated[index]) {
          const instance = instances[index];
          updated[index] = {
            url: instance?.url || "",
            name: instance?.name || "",
            auth_type: "apikey",
            username: "",
            password: "",
            apiKey: "",
          };
        }
        const instance = instances[index];
        updated[index] = {
          ...updated[index],
          url: instance?.url || updated[index].url || "",
          name: instance?.name || updated[index].name || "",
          [field]: value,
        };
        return { ...prev, portainerInstances: updated };
      });
    },
    [currentUser, handleCredentialUpdate]
  );

  // Update credential for current user (wrapper for DockerHub step)
  const handleDockerHubCredentialUpdate = useCallback(
    (field, value) => {
      handleCredentialUpdate((prev) => ({
        ...prev,
        dockerHub: { ...prev.dockerHub, [field]: value },
      }));
      if (currentUser) {
        const username = currentUser.username;
        setUserStepErrors((prev) => {
          const updated = { ...prev };
          if (updated[username]) {
            delete updated[username].dockerhub_username;
            delete updated[username].dockerhub_token;
          }
          return updated;
        });
        setError("");
      }
    },
    [currentUser, handleCredentialUpdate, setUserStepErrors, setError]
  );

  // Update credential for current user (wrapper for Discord step)
  const handleDiscordCredentialUpdate = useCallback(
    (index, field, value) => {
      handleCredentialUpdate((prev) => {
        const discord = prev.discordWebhooks || [];
        const updated = [...discord];
        if (!updated[index]) {
          updated[index] = { webhookUrl: "" };
        }
        updated[index][field] = value;
        return { ...prev, discordWebhooks: updated };
      });
    },
    [handleCredentialUpdate]
  );

  // Handle token change
  const handleTokenChange = useCallback(
    (username, token) => {
      setVerificationInputTokens((prev) => ({ ...prev, [username]: token }));
    },
    [setVerificationInputTokens]
  );

  // Handle remove instance (for Portainer step)
  const handleRemoveInstance = useCallback(
    (index) => {
      if (!currentUser) return;
      const username = currentUser.username;
      const instances = currentUser.portainerInstances || [];
      const updatedInstances = instances.filter((_, i) => i !== index);

      // Update usersData to reflect the removal
      setUsersData((prev) => {
        if (!prev) return prev;
        const updatedUsers = [...prev.users];
        updatedUsers[currentUserIndex] = {
          ...updatedUsers[currentUserIndex],
          portainerInstances: updatedInstances,
        };
        return { ...prev, users: updatedUsers };
      });

      // Remove corresponding credentials
      handleCredentialUpdate((prev) => {
        const portainer = prev.portainerInstances || [];
        const updated = portainer.filter((_, i) => i !== index);
        return { ...prev, portainerInstances: updated };
      });

      // Clear Portainer step errors when instance is deleted
      if (updatedInstances.length === 0) {
        setUserStepErrors((prev) => {
          const updated = { ...prev };
          if (updated[username]) {
            delete updated[username][STEP_TYPES.PORTAINER];
          }
          return updated;
        });
        setError("");
      } else {
        // Clear all portainer-related field errors
        setUserStepErrors((prev) => {
          const updated = { ...prev };
          if (updated[username]) {
            Object.keys(updated[username]).forEach((key) => {
              if (key.startsWith("portainer_")) {
                delete updated[username][key];
              }
            });
            delete updated[username][STEP_TYPES.PORTAINER];
          }
          return updated;
        });
        setError("");
      }

      // Re-index credentials to match remaining instances
      if (updatedInstances.length > 0) {
        handleCredentialUpdate((prev) => {
          const portainer = prev.portainerInstances || [];
          const reindexed = updatedInstances.map((instance) => {
            const matchingCred = portainer.find((cred) => cred.url === instance.url);
            if (matchingCred) {
              return {
                ...matchingCred,
                url: instance.url,
                name: instance.name,
              };
            }
            return {
              url: instance.url,
              name: instance.name,
              auth_type: instance.auth_type || "apikey",
              username: "",
              password: "",
              apiKey: "",
            };
          });
          return { ...prev, portainerInstances: reindexed };
        });
      }

      // If no instances left, skip the step
      if (updatedInstances.length === 0) {
        setUserSkippedSteps((prev) => {
          const skipped = new Set(prev[username] || []);
          skipped.add(STEP_TYPES.PORTAINER);
          return { ...prev, [username]: skipped };
        });
      }
    },
    [
      currentUser,
      currentUserIndex,
      setUsersData,
      handleCredentialUpdate,
      setUserSkippedSteps,
      setUserStepErrors,
      setError,
    ]
  );

  const handleClose = useCallback(() => {
    // If users were imported, show success message before closing
    if (importedUsers.length > 0) {
      const message = `Successfully imported ${importedUsers.length} user(s)`;
      onSuccess(message);
    }
    onClose();
  }, [onClose, onSuccess, importedUsers]);

  // If on file selection step (before import has started)
  if (!importStarted && currentUserIndex === 0 && currentStepIndex === 0 && !importing) {
    return (
      <Modal isOpen={isOpen} onClose={handleClose} title="Import Users" size="lg">
        <FileUploadStep
          file={file}
          usersData={usersData}
          preImportErrors={importErrors}
          error={error}
          loading={loading}
          fileInputRef={fileInputRef}
          onFileChange={handleFileChange}
          onFileButtonClick={handleFileButtonClick}
          onStartImport={handleStartImport}
          onClose={handleClose}
        />
      </Modal>
    );
  }

  // Import flow - show current user's current step
  const getStepTitle = () => {
    if (!currentUser) return "Import Users";

    const stepNames = {
      [STEP_TYPES.INSTANCE_ADMIN_VERIFICATION]: "Instance Admin Verification",
      [STEP_TYPES.PASSWORD]: "Set Password",
      [STEP_TYPES.PORTAINER]: "Portainer Credentials",
      [STEP_TYPES.DOCKERHUB]: "Docker Hub Credentials",
      [STEP_TYPES.DISCORD]: "Discord Webhooks",
    };

    return `Import User ${currentUserIndex + 1} of ${totalUsers}: ${stepNames[currentStepType] || "Unknown"}`;
  };

  const getStepIndicator = () => {
    if (!currentUser) return "";
    return `Step ${currentStepIndex + 1} of ${totalStepsForCurrentUser}: ${currentUser.username}`;
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={getStepTitle()} size="lg">
      <div className={styles.form}>
        <div className={styles.stepIndicator}>
          <span>{getStepIndicator()}</span>
          <Button
            variant="secondary"
            onClick={handleSkipUser}
            disabled={importing || loading}
            title={
              totalUsers > 1
                ? "Skip this entire user and move to the next user"
                : "Skip this entire user and complete import"
            }
            size="sm"
          >
            Skip User
          </Button>
        </div>

        <div className={styles.stepWrapper}>
          <StepRenderer
            stepType={currentStepType}
            currentUser={currentUser}
            userPasswords={userPasswords}
            userCredentials={userCredentials}
            userStepErrors={userStepErrors}
            verificationStatus={verificationStatus}
            verifying={verifying}
            regenerating={regenerating}
            generating={generating}
            verificationTokens={verificationTokens}
            verificationInputTokens={verificationInputTokens}
            onGenerateToken={handleGenerateToken}
            onRegenerateToken={handleRegenerateToken}
            onVerifyToken={handleVerifyToken}
            onTokenChange={handleTokenChange}
            onPasswordChange={handlePasswordChange}
            onPortainerCredentialUpdate={handlePortainerCredentialUpdate}
            onDockerHubCredentialUpdate={handleDockerHubCredentialUpdate}
            onDiscordCredentialUpdate={handleDiscordCredentialUpdate}
            onRemoveInstance={handleRemoveInstance}
            setUsersData={setUsersData}
            currentUserIndex={currentUserIndex}
            setUserSkippedSteps={setUserSkippedSteps}
            setError={setError}
            setVerificationStatus={setVerificationStatus}
            setUserStepErrors={setUserStepErrors}
          />
        </div>

        {error && (
          <Alert variant="error" className={styles.alert}>
            {error}
          </Alert>
        )}

        {/* Only show errors that occurred during import, not pre-import errors */}
        {importStarted && importErrors.length > 0 && (
          <Alert variant="warning" className={styles.alert}>
            <div>
              <strong>Import Errors:</strong>
              <ul>
                {importErrors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          </Alert>
        )}

        <div className={styles.actions}>
          <div className={styles.actionsLeft}>
            {(currentStepIndex > 0 || currentUserIndex > 0) && (
              <Button variant="secondary" onClick={handleBack} disabled={importing || loading}>
                Back
              </Button>
            )}
          </div>

          <div className={styles.actionsRight}>
            {[
              STEP_TYPES.PORTAINER,
              STEP_TYPES.DOCKERHUB,
              STEP_TYPES.DISCORD,
              STEP_TYPES.INSTANCE_ADMIN_VERIFICATION,
            ].includes(currentStepType) && (
              <Button
                variant="outline"
                onClick={handleSkip}
                disabled={importing || loading}
                className={styles.skipStepButton}
              >
                Skip Step
              </Button>
            )}
            <Button variant="secondary" onClick={handleClose} disabled={importing || loading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleNext}
              disabled={importing || loading}
              loading={importing || loading}
            >
              {importing
                ? "Creating User..."
                : currentStepIndex < totalStepsForCurrentUser - 1
                  ? "Next"
                  : currentUserIndex < totalUsers - 1
                    ? "Next User"
                    : "Finish"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

ImportUsersModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func.isRequired,
};

export default ImportUsersModal;

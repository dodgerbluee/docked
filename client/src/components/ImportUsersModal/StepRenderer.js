import React from "react";
import PropTypes from "prop-types";
import InstanceAdminVerificationStep from "./InstanceAdminVerificationStep";
import PasswordStep from "./PasswordStep";
import PortainerCredentialsStep from "../settings/ImportCredentialsModal/PortainerCredentialsStep";
import DockerHubCredentialsStep from "../settings/ImportCredentialsModal/DockerHubCredentialsStep";
import DiscordCredentialsStep from "../settings/ImportCredentialsModal/DiscordCredentialsStep";

// Step types
const STEP_TYPES = {
  INSTANCE_ADMIN_VERIFICATION: "instance_admin_verification",
  PASSWORD: "password",
  PORTAINER: "portainer",
  DOCKERHUB: "dockerhub",
  DISCORD: "discord",
};

/**
 * StepRenderer Component
 * Renders the appropriate step component based on step type
 */
function StepRenderer({
  stepType,
  currentUser,
  userPasswords,
  userCredentials,
  userStepErrors,
  verificationStatus,
  verifying,
  regenerating,
  generating,
  verificationTokens,
  verificationInputTokens,
  onGenerateToken,
  onRegenerateToken,
  onVerifyToken,
  onTokenChange,
  onPasswordChange,
  onPortainerCredentialUpdate,
  onDockerHubCredentialUpdate,
  onDiscordCredentialUpdate,
  onRemoveInstance,
  setUsersData,
  currentUserIndex,
  setUserSkippedSteps,
  setError,
  setVerificationStatus,
  setUserStepErrors,
}) {
  if (!currentUser) return null;

  const username = currentUser.username;
  const creds = userCredentials[username] || {};
  const errors = userStepErrors[username] || {};

  if (stepType === STEP_TYPES.INSTANCE_ADMIN_VERIFICATION) {
    const verified = verificationStatus[username];
    const isVerifying = verifying[username];
    const isRegenerating = regenerating[username];
    const isGenerating = generating[username];
    const token = verificationTokens[username];
    const verificationError = errors[STEP_TYPES.INSTANCE_ADMIN_VERIFICATION];
    const currentInputToken = verificationInputTokens[username] || "";

    return (
      <InstanceAdminVerificationStep
        user={{ username }}
        token={token}
        onRegenerate={() => onRegenerateToken(username)}
        onGenerate={() => onGenerateToken(username)}
        onTokenChange={(inputToken) => {
          const previousInput = currentInputToken;
          const newInput = inputToken || "";

          onTokenChange(username, inputToken);

          if (verificationError && newInput !== previousInput && newInput.length > 0) {
            setUserStepErrors((prev) => {
              const updated = { ...prev };
              if (updated[username]) {
                delete updated[username][STEP_TYPES.INSTANCE_ADMIN_VERIFICATION];
              }
              return updated;
            });
            setVerificationStatus((prev) => ({ ...prev, [username]: undefined }));
          }
        }}
        verifying={isVerifying}
        regenerating={isRegenerating}
        generating={isGenerating}
        verified={verified}
        error={verificationError}
      />
    );
  }

  if (stepType === STEP_TYPES.PASSWORD) {
    return (
      <PasswordStep
        username={username}
        password={userPasswords[username] || ""}
        onPasswordChange={onPasswordChange}
        errors={errors}
      />
    );
  }

  if (stepType === STEP_TYPES.PORTAINER) {
    const instances = currentUser?.portainerInstances || [];
    // This step should only appear if instances exist (auto-skipped if not)
    // But keep check as safety fallback
    if (instances.length === 0) {
      return null; // Step should have been auto-skipped
    }

    return (
      <PortainerCredentialsStep
        instances={instances}
        credentials={creds}
        errors={errors}
        onUpdateCredential={onPortainerCredentialUpdate}
        onRemoveInstance={onRemoveInstance}
      />
    );
  }

  if (stepType === STEP_TYPES.DOCKERHUB) {
    // Only show Docker Hub step if credentials exist in import file
    const hasDockerHubData =
      currentUser?.dockerHubCredentials &&
      (currentUser.dockerHubCredentials.username || currentUser.dockerHubCredentials.token);
    if (!hasDockerHubData) {
      return null; // Step should have been auto-skipped
    }

    return (
      <DockerHubCredentialsStep
        credentials={creds}
        errors={errors}
        onUpdateCredential={onDockerHubCredentialUpdate}
      />
    );
  }

  if (stepType === STEP_TYPES.DISCORD) {
    const webhooks = currentUser?.discordWebhooks || [];
    // This step should only appear if webhooks exist (auto-skipped if not)
    // But keep check as safety fallback
    if (webhooks.length === 0) {
      return null; // Step should have been auto-skipped
    }

    return (
      <DiscordCredentialsStep
        webhooks={webhooks}
        credentials={creds}
        errors={errors}
        onUpdateCredential={onDiscordCredentialUpdate}
      />
    );
  }

  return null;
}

StepRenderer.propTypes = {
  stepType: PropTypes.string.isRequired,
  currentUser: PropTypes.object,
  userPasswords: PropTypes.object.isRequired,
  userCredentials: PropTypes.object.isRequired,
  userStepErrors: PropTypes.object.isRequired,
  verificationStatus: PropTypes.object.isRequired,
  verifying: PropTypes.object.isRequired,
  regenerating: PropTypes.object.isRequired,
  generating: PropTypes.object.isRequired,
  verificationTokens: PropTypes.object.isRequired,
  verificationInputTokens: PropTypes.object.isRequired,
  onGenerateToken: PropTypes.func.isRequired,
  onRegenerateToken: PropTypes.func.isRequired,
  onVerifyToken: PropTypes.func.isRequired,
  onTokenChange: PropTypes.func.isRequired,
  onPasswordChange: PropTypes.func.isRequired,
  onPortainerCredentialUpdate: PropTypes.func.isRequired,
  onDockerHubCredentialUpdate: PropTypes.func.isRequired,
  onDiscordCredentialUpdate: PropTypes.func.isRequired,
  onRemoveInstance: PropTypes.func.isRequired,
  setUsersData: PropTypes.func.isRequired,
  currentUserIndex: PropTypes.number.isRequired,
  setUserSkippedSteps: PropTypes.func.isRequired,
  setError: PropTypes.func.isRequired,
  setVerificationStatus: PropTypes.func.isRequired,
  setUserStepErrors: PropTypes.func.isRequired,
};

export default StepRenderer;

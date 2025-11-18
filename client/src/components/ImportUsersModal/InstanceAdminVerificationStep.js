import React, { useEffect } from "react";
import PropTypes from "prop-types";
import TokenVerificationStep from "../ui/TokenVerificationStep";
import { Shield } from "lucide-react";

/**
 * InstanceAdminVerificationStep Component
 * Wrapper around TokenVerificationStep with instance admin specific configuration
 * Tokens are NOT displayed in UI - they are only logged to server logs
 * Automatically generates token when component loads
 */
function InstanceAdminVerificationStep({ user, token, onRegenerate, onGenerate, onTokenChange, verifying, regenerating, generating, verified, error }) {
  const username = typeof user === "string" ? user : (user?.username || "");
  
  // Generate token when component loads (if not already generated)
  useEffect(() => {
    if (username && onGenerate && !token && !generating) {
      onGenerate(username);
    }
  }, [username, onGenerate, token, generating]);

  return (
    <TokenVerificationStep
      title="Instance Admin Verification"
      icon={Shield}
      user={user}
      token={token}
      tokenLabel="Verification Token"
      instruction="This user is marked as an instance admin. A verification token has been generated and logged to the container logs. Please check the server logs for the token and enter it below to verify, or skip to import without verification."
      onRegenerate={onRegenerate}
      onTokenChange={onTokenChange}
      verifying={verifying}
      regenerating={regenerating}
      verified={verified}
      error={error}
      skipLabel="Skip"
      showToken={false}
      tokenPlaceholder="Enter verification token from server logs (e.g., XXXX-XXXX-XXXX)"
    />
  );
}

InstanceAdminVerificationStep.propTypes = {
  user: PropTypes.shape({
    username: PropTypes.string.isRequired,
  }).isRequired,
  token: PropTypes.string,
  onRegenerate: PropTypes.func,
  onGenerate: PropTypes.func,
  onTokenChange: PropTypes.func,
  verifying: PropTypes.bool,
  regenerating: PropTypes.bool,
  generating: PropTypes.bool,
  verified: PropTypes.bool, // true = verified, false = failed, undefined = not attempted
  error: PropTypes.string, // Error message to display when verification fails
};

export default InstanceAdminVerificationStep;


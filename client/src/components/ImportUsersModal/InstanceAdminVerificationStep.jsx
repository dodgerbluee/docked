import React, { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import TokenVerificationStep from "../ui/TokenVerificationStep";
import { Shield } from "lucide-react";

/**
 * InstanceAdminVerificationStep Component
 * Wrapper around TokenVerificationStep with instance admin specific configuration
 * Tokens are NOT displayed in UI - they are only logged to server logs
 * Automatically generates token when component loads
 */
function InstanceAdminVerificationStep({
  user,
  generated,
  onRegenerate,
  onGenerate,
  onTokenChange,
  verifying,
  regenerating,
  generating,
  verified,
  error,
}) {
  const username = typeof user === "string" ? user : user?.username || "";
  const attemptedForRef = useRef(null);

  // Generate token when component loads (if not already generated). The
  // token itself is never returned to the client - it is only written to
  // the container logs - so `generated` is the marker that a pending token
  // exists for this username.
  useEffect(() => {
    // One attempt per username: a failed generate leaves `generated` false and
    // `generating` false again, which would re-arm this effect and hammer the
    // server. The Regenerate button is the retry path.
    if (!username || attemptedForRef.current === username) return;
    if (onGenerate && !generated && !generating) {
      attemptedForRef.current = username;
      onGenerate(username);
    }
  }, [username, onGenerate, generated, generating]);

  return (
    <TokenVerificationStep
      title="Instance Admin Verification"
      icon={Shield}
      user={user}
      tokenLabel="Verification Token"
      instruction="This user is marked as an instance admin. A verification token has been generated and logged to the container logs. Check the server logs for the token and enter it below to verify. Skipping imports this user WITHOUT instance-admin privileges."
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
  generated: PropTypes.bool,
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

import React, { useEffect } from "react";
import PropTypes from "prop-types";
import TokenVerificationStep from "../ui/TokenVerificationStep";
import { Key } from "lucide-react";

/**
 * RegistrationCodeStep Component
 * Wrapper around TokenVerificationStep for first user registration code verification
 * Code is NOT displayed in UI - it is only logged to server logs
 * Automatically generates code when component loads
 */
function RegistrationCodeStep({ codeGenerated, onGenerate, onRegenerate, onTokenChange, verifying, regenerating, generating, verified }) {
  // Generate code when component loads (if not already generated)
  useEffect(() => {
    if (onGenerate && !codeGenerated && !generating && !regenerating) {
      onGenerate();
    }
  }, [onGenerate, codeGenerated, generating, regenerating]);

  return (
    <TokenVerificationStep
      title="First User Registration"
      icon={Key}
      token={null}
      tokenLabel="Registration Code"
      instruction="This is the first user account. A registration code has been generated and logged to the container logs. Please check the server logs for the code and enter it below to continue."
      onRegenerate={onRegenerate}
      onTokenChange={onTokenChange}
      verifying={verifying}
      regenerating={regenerating}
      generating={generating}
      verified={verified}
      showToken={false}
      tokenPlaceholder="Enter registration code from server logs (e.g., XXXX-XXXX-XXXX)"
    />
  );
}

RegistrationCodeStep.propTypes = {
  codeGenerated: PropTypes.bool,
  onGenerate: PropTypes.func,
  onRegenerate: PropTypes.func,
  onTokenChange: PropTypes.func,
  verifying: PropTypes.bool,
  regenerating: PropTypes.bool,
  generating: PropTypes.bool,
  verified: PropTypes.bool, // true = verified, false = failed, undefined = not attempted
};

export default RegistrationCodeStep;


/**
 * Credentials step manager component
 */

import React from "react";
import PropTypes from "prop-types";
import SourceCredentialsStep from "../ImportCredentialsModal/SourceCredentialsStep";
import DiscordCredentialsStep from "../ImportCredentialsModal/DiscordCredentialsStep";

/**
 * Credentials step manager component
 * @param {Object} props
 * @param {Array} props.steps - Steps array
 * @param {number} props.currentStep - Current step index
 * @param {Object} props.configData - Configuration data
 * @param {Object} props.credentials - Credentials object
 * @param {Object} props.errors - Errors object
 * @param {Function} props.onUpdateSourceCred - Source credential update handler
 * @param {Function} props.onUpdateDiscordCred - Discord credential update handler
 */
const CredentialsStepManager = ({
  steps,
  currentStep,
  configData,
  credentials,
  errors,
  onUpdateSourceCred,
  onUpdateDiscordCred,
}) => {
  if (steps.length === 0) return null;
  const stepName = steps[currentStep];

  switch (stepName) {
    case "sources":
      return (
        <SourceCredentialsStep
          instances={configData.sourceInstances || []}
          credentials={credentials}
          errors={errors}
          onUpdateCredential={onUpdateSourceCred}
        />
      );
    case "discord":
      return (
        <DiscordCredentialsStep
          webhooks={configData.discordWebhooks || []}
          credentials={credentials}
          errors={errors}
          onUpdateCredential={onUpdateDiscordCred}
        />
      );
    default:
      return null;
  }
};

CredentialsStepManager.propTypes = {
  steps: PropTypes.array.isRequired,
  currentStep: PropTypes.number.isRequired,
  configData: PropTypes.object.isRequired,
  credentials: PropTypes.object.isRequired,
  errors: PropTypes.object.isRequired,
  onUpdateSourceCred: PropTypes.func.isRequired,
  onUpdateDiscordCred: PropTypes.func.isRequired,
};

export default CredentialsStepManager;

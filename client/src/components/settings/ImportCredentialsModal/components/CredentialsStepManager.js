/**
 * Credentials step manager component
 */

import React from "react";
import PropTypes from "prop-types";
import PortainerCredentialsStep from "../ImportCredentialsModal/PortainerCredentialsStep";
import DiscordCredentialsStep from "../ImportCredentialsModal/DiscordCredentialsStep";

/**
 * Credentials step manager component
 * @param {Object} props
 * @param {Array} props.steps - Steps array
 * @param {number} props.currentStep - Current step index
 * @param {Object} props.configData - Configuration data
 * @param {Object} props.credentials - Credentials object
 * @param {Object} props.errors - Errors object
 * @param {Function} props.onUpdatePortainerCred - Portainer credential update handler
 * @param {Function} props.onUpdateDiscordCred - Discord credential update handler
 */
const CredentialsStepManager = ({
  steps,
  currentStep,
  configData,
  credentials,
  errors,
  onUpdatePortainerCred,
  onUpdateDiscordCred,
}) => {
  if (steps.length === 0) return null;
  const stepName = steps[currentStep];

  switch (stepName) {
    case "portainer":
      return (
        <PortainerCredentialsStep
          instances={configData.portainerInstances || []}
          credentials={credentials}
          errors={errors}
          onUpdateCredential={onUpdatePortainerCred}
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
  onUpdatePortainerCred: PropTypes.func.isRequired,
  onUpdateDiscordCred: PropTypes.func.isRequired,
};

export default CredentialsStepManager;

import React from "react";
import PropTypes from "prop-types";
import { Package, Lock, Trash2 } from "lucide-react";
import Input from "../../ui/Input";
import ToggleButton from "../../ui/ToggleButton";
import styles from "../ImportCredentialsModal.module.css";

const AUTH_TYPE_OPTIONS = [
  {
    value: "apikey",
    label: "API Key",
    icon: Package,
  },
  {
    value: "password",
    label: "Username / Password",
    icon: Lock,
  },
];

/**
 * PortainerCredentialsStep Component
 * Step component for collecting Portainer instance credentials
 */
function PortainerCredentialsStep({
  instances,
  credentials,
  errors,
  onUpdateCredential,
  onRemoveInstance,
}) {
  return (
    <div className={styles.stepContent}>
      <h3 className={styles.stepTitle}>Portainer Instances</h3>
      <p className={styles.stepDescription}>
        Enter credentials for each Portainer instance you want to import.
      </p>

      {instances.map((instance, index) => {
        const cred = credentials.portainerInstances?.[index] || {};
        const authType = cred.auth_type || "apikey";

        return (
          <div key={index} className={styles.instanceCard}>
            <div className={styles.instanceHeader}>
              <h4 className={styles.instanceName}>{instance.name || instance.url}</h4>
              <div className={styles.instanceHeaderActions}>
                <ToggleButton
                  options={AUTH_TYPE_OPTIONS}
                  value={authType}
                  onChange={(value) => onUpdateCredential(index, "auth_type", value)}
                  size="sm"
                />
                {onRemoveInstance && (
                  <button
                    type="button"
                    className={styles.deleteButton}
                    onClick={() => onRemoveInstance(index)}
                    title="Remove this instance from import"
                    aria-label={`Remove ${instance.name || instance.url}`}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>

            {authType === "apikey" ? (
              <div className={styles.formGroup}>
                <label className={styles.label}>API Key</label>
                <Input
                  type="password"
                  value={cred.apiKey || ""}
                  onChange={(e) => onUpdateCredential(index, "apiKey", e.target.value)}
                  placeholder="Enter API key"
                  error={errors[`portainer_${index}_apiKey`]}
                />
              </div>
            ) : (
              <>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Username</label>
                  <Input
                    type="text"
                    value={cred.username || ""}
                    onChange={(e) => onUpdateCredential(index, "username", e.target.value)}
                    placeholder="Enter username"
                    error={errors[`portainer_${index}_username`]}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Password</label>
                  <Input
                    type="password"
                    value={cred.password || ""}
                    onChange={(e) => onUpdateCredential(index, "password", e.target.value)}
                    placeholder="Enter password"
                    error={errors[`portainer_${index}_password`]}
                  />
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

PortainerCredentialsStep.propTypes = {
  instances: PropTypes.arrayOf(PropTypes.object).isRequired,
  credentials: PropTypes.object.isRequired,
  errors: PropTypes.object.isRequired,
  onUpdateCredential: PropTypes.func.isRequired,
  onRemoveInstance: PropTypes.func,
};

export default PortainerCredentialsStep;

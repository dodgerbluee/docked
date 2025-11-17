import React from "react";
import PropTypes from "prop-types";
import Input from "../../ui/Input";
import styles from "../ImportCredentialsModal.module.css";

/**
 * DockerHubCredentialsStep Component
 * Step component for collecting Docker Hub credentials
 */
function DockerHubCredentialsStep({ credentials, errors, onUpdateCredential }) {
  return (
    <div className={styles.stepContent}>
      <h3 className={styles.stepTitle}>Docker Hub Credentials</h3>
      <p className={styles.stepDescription}>Enter your Docker Hub username and access token.</p>

      <div className={styles.formGroup}>
        <label className={styles.label}>Username</label>
        <Input
          type="text"
          value={credentials.dockerHub?.username || ""}
          onChange={(e) => onUpdateCredential("username", e.target.value)}
          placeholder="Enter Docker Hub username"
          error={errors.dockerhub_username}
        />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label}>Access Token</label>
        <Input
          type="password"
          value={credentials.dockerHub?.token || ""}
          onChange={(e) => onUpdateCredential("token", e.target.value)}
          placeholder="Enter Docker Hub access token"
          error={errors.dockerhub_token}
        />
      </div>
    </div>
  );
}

DockerHubCredentialsStep.propTypes = {
  credentials: PropTypes.object.isRequired,
  errors: PropTypes.object.isRequired,
  onUpdateCredential: PropTypes.func.isRequired,
};

export default DockerHubCredentialsStep;

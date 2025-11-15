import React, { useState } from "react";
import PropTypes from "prop-types";
import DockerHubCredsModal from "../DockerHubCredsModal";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import ActionButtons from "../ui/ActionButtons";
import ConfirmDialog from "../ui/ConfirmDialog";
import styles from "./DockerHubTab.module.css";

/**
 * DockerHubTab Component
 * Manages Docker Hub credentials
 */
const DockerHubTab = React.memo(function DockerHubTab({
  dockerHubCredentials,
  showDockerHubModal,
  setShowDockerHubModal,
  dockerHubSuccess,
  handleDockerHubModalSuccess,
  handleDeleteDockerHubCreds,
}) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const handleDeleteClick = () => {
    setDeleteConfirm(true);
  };

  const handleDeleteConfirm = () => {
    handleDeleteDockerHubCreds();
    setDeleteConfirm(false);
  };

  return (
    <div className={styles.updateSection}>
      <h3 className={styles.title}>Docker Hub Authentication</h3>

      <Card variant="default" padding="lg" className={styles.infoCard}>
        <h4 className={styles.cardTitle}>What is this used for?</h4>
        <p className={styles.cardText}>
          Docker Hub authentication allows the application to use your personal account's rate
          limits instead of anonymous IP-based limits when checking for container updates.
        </p>
        <h4 className={styles.benefitsTitle}>Benefits:</h4>
        <ul className={styles.benefitsList}>
          <li>
            <strong>Higher Rate Limits:</strong> Authenticated users get 200 API requests per 6
            hours vs 100 for anonymous users
          </li>
          <li>
            <strong>Faster Updates:</strong> With higher limits, the application can check more
            containers without hitting rate limits
          </li>
          <li>
            <strong>Reduced Errors:</strong> Fewer 429 (rate limit) errors means more reliable
            update detection
          </li>
          <li>
            <strong>Better Performance:</strong> Shorter delays between API calls (500ms vs 1000ms)
            when authenticated
          </li>
        </ul>
        <p className={styles.cardNote}>
          <strong>Note:</strong> Your credentials are stored securely in the database and only used
          for Docker Hub API authentication. You can create a Personal Access Token at{" "}
          <a
            href="https://hub.docker.com/settings/security"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            hub.docker.com
          </a>
          .
        </p>
      </Card>

      {dockerHubSuccess && <Alert variant="info">{dockerHubSuccess}</Alert>}

      {dockerHubCredentials ? (
        <Card variant="default" padding="md" className={styles.credentialsCard}>
          <div className={styles.credentialsContent}>
            <div className={styles.credentialsInfo}>
              <strong className={styles.configTitle}>Current Configuration</strong>
              <div className={styles.configDetail}>Username: {dockerHubCredentials.username}</div>
              <div className={styles.configMeta}>
                {dockerHubCredentials.hasToken ? (
                  <span className={styles.statusSuccess}>✓ Token configured</span>
                ) : (
                  <span className={styles.statusError}>✗ No token</span>
                )}
                {dockerHubCredentials.updated_at && (
                  <span className={styles.lastUpdated}>
                    • Last updated: {new Date(dockerHubCredentials.updated_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            <ActionButtons
              onEdit={() => setShowDockerHubModal(true)}
              onDelete={handleDeleteClick}
            />
          </div>
        </Card>
      ) : (
        <Card variant="default" padding="lg" className={styles.emptyCard}>
          <p className={styles.emptyText}>
            No Docker Hub credentials configured. Add credentials to increase your rate limits.
          </p>
          <Button
            variant="primary"
            onClick={() => setShowDockerHubModal(true)}
            className={styles.createButton}
          >
            Create Entry
          </Button>
        </Card>
      )}

      <DockerHubCredsModal
        isOpen={showDockerHubModal}
        onClose={() => setShowDockerHubModal(false)}
        onSuccess={handleDockerHubModalSuccess}
        existingCredentials={dockerHubCredentials}
      />

      <ConfirmDialog
        isOpen={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={handleDeleteConfirm}
        title="Remove Docker Hub Credentials?"
        message="Are you sure you want to remove Docker Hub credentials? This will revert to anonymous rate limits."
        confirmText="Remove"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
});

DockerHubTab.propTypes = {
  dockerHubCredentials: PropTypes.object,
  showDockerHubModal: PropTypes.bool.isRequired,
  setShowDockerHubModal: PropTypes.func.isRequired,
  dockerHubSuccess: PropTypes.string,
  handleDockerHubModalSuccess: PropTypes.func.isRequired,
  handleDeleteDockerHubCreds: PropTypes.func.isRequired,
};

export default DockerHubTab;

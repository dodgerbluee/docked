import React, { useState, useRef } from "react";
import PropTypes from "prop-types";
import DiscordWebhookModal from "../DiscordWebhookModal";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import ActionButtons from "../ui/ActionButtons";
import ConfirmDialog from "../ui/ConfirmDialog";
import styles from "./DiscordTab.module.css";

/**
 * DiscordTab Component
 * Manages Discord webhooks
 */
const DiscordTab = React.memo(function DiscordTab({
  discordWebhooks,
  showDiscordModal,
  setShowDiscordModal,
  editingDiscordWebhook,
  setEditingDiscordWebhook,
  discordSuccess,
  handleDiscordModalSuccess,
  handleDeleteDiscordWebhook,
}) {
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, webhookId: null });
  const downloadLinkRef = useRef(null);

  const handleDeleteClick = (webhookId) => {
    setDeleteConfirm({ isOpen: true, webhookId });
  };

  const handleDeleteConfirm = () => {
    if (deleteConfirm.webhookId) {
      handleDeleteDiscordWebhook(deleteConfirm.webhookId);
    }
    setDeleteConfirm({ isOpen: false, webhookId: null });
  };

  const handleAddWebhook = () => {
    setEditingDiscordWebhook(null);
    setShowDiscordModal(true);
  };

  const handleEditWebhook = (webhook) => {
    setEditingDiscordWebhook(webhook);
    setShowDiscordModal(true);
  };

  const handleDownloadLogo = () => {
    if (downloadLinkRef.current) {
      downloadLinkRef.current.click();
    }
  };

  return (
    <div className={styles.updateSection}>
      <h3 className={styles.title}>Discord Notifications</h3>
      <p className={styles.description}>
        Configure Discord webhooks to receive notifications when new versions
        of tracked software are available. You can add up to 3 webhooks.
      </p>

      {discordSuccess && <Alert variant="info">{discordSuccess}</Alert>}

      {discordWebhooks.length > 0 && (
        <div className={styles.webhooksList}>
          {discordWebhooks.map((webhook) => (
            <Card key={webhook.id} variant="default" padding="md" className={styles.webhookCard}>
              <div className={styles.webhookContent}>
                <div className={styles.webhookInfo}>
                  {webhook.avatarUrl && (
                    <img
                      src={webhook.avatarUrl}
                      alt="Server avatar"
                      className={styles.avatar}
                      onError={(e) => {
                        e.target.style.display = "none";
                      }}
                    />
                  )}
                  <div className={styles.webhookDetails}>
                    <strong className={styles.serverName}>
                      {webhook.serverName || "Unnamed Server"}
                    </strong>
                    {webhook.channelName && (
                      <div className={styles.channelName}>
                        Channel: {webhook.channelName}
                      </div>
                    )}
                    <div className={styles.webhookMeta}>
                      {webhook.enabled ? (
                        <span className={styles.statusEnabled}>✓ Enabled</span>
                      ) : (
                        <span className={styles.statusDisabled}>✗ Disabled</span>
                      )}
                      {webhook.updatedAt && (
                        <span className={styles.lastUpdated}>
                          • Last updated:{" "}
                          {new Date(webhook.updatedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <ActionButtons
                  onEdit={() => handleEditWebhook(webhook)}
                  onDelete={() => handleDeleteClick(webhook.id)}
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      {discordWebhooks.length < 3 && (
        <Button
          type="button"
          variant="primary"
          onClick={handleAddWebhook}
          className={styles.addButton}
        >
          Add Webhook
        </Button>
      )}

      {discordWebhooks.length >= 3 && (
        <p className={styles.maxReached}>
          Maximum of 3 webhooks reached. Remove an existing webhook to add a new
          one.
        </p>
      )}

      <Card variant="default" padding="md" className={styles.instructionsCard}>
        <h4 className={styles.instructionsTitle}>How to Set Up Discord Webhooks</h4>
        <ol className={styles.instructionsList}>
          <li>Open your Discord server</li>
          <li>
            Go to <strong>Server Settings</strong> → <strong>Integrations</strong> →{" "}
            <strong>Webhooks</strong>
          </li>
          <li>Click <strong>"New Webhook"</strong></li>
          <li>
            Open and customize the webhook details:
            <ul className={styles.instructionsSubList}>
              <li>Choose the channel where you want notifications</li>
              <li>Rename it <strong><i>Docked</i></strong></li>
              <li>
                Use the Docked logo as the webhook avatar
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleDownloadLogo}
                  className={styles.downloadButton}
                >
                  Download Logo
                </Button>
                <a
                  ref={downloadLinkRef}
                  href="/img/logo.png"
                  download="docked-logo.png"
                  style={{ display: "none" }}
                  aria-hidden="true"
                  aria-label="Download logo"
                >
                  Download Logo
                </a>
              </li>
            </ul>
          </li>
          <li>Copy the webhook URL</li>
          <li>Click <strong>"Add Webhook"</strong> above and paste the URL</li>
          <li>Optionally add a server name for easy identification</li>
        </ol>
      </Card>

      <DiscordWebhookModal
        isOpen={showDiscordModal}
        onClose={() => {
          setShowDiscordModal(false);
          setEditingDiscordWebhook(null);
        }}
        onSuccess={handleDiscordModalSuccess}
        existingWebhook={editingDiscordWebhook}
      />

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, webhookId: null })}
        onConfirm={handleDeleteConfirm}
        title="Remove Discord Webhook?"
        message="Are you sure you want to remove this Discord webhook?"
        confirmText="Remove"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
});

DiscordTab.propTypes = {
  discordWebhooks: PropTypes.arrayOf(PropTypes.object).isRequired,
  showDiscordModal: PropTypes.bool.isRequired,
  setShowDiscordModal: PropTypes.func.isRequired,
  editingDiscordWebhook: PropTypes.object,
  setEditingDiscordWebhook: PropTypes.func.isRequired,
  discordSuccess: PropTypes.string,
  handleDiscordModalSuccess: PropTypes.func.isRequired,
  handleDeleteDiscordWebhook: PropTypes.func.isRequired,
};

export default DiscordTab;

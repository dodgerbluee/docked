import React, { useState } from "react";
import PropTypes from "prop-types";
import { Info } from "lucide-react";
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

  return (
    <div className={styles.updateSection}>
      <h3 className={styles.title}>Discord Notifications</h3>
      <p className={styles.description}>
        Configure Discord webhooks to receive notifications when new versions of tracked software
        are available. You can add up to 3 webhooks.
      </p>

      {discordSuccess && <Alert variant="info">{discordSuccess}</Alert>}

      <Card variant="secondary" padding="md" className={styles.infoBanner}>
        <div className={styles.infoContent}>
          <Info size={20} className={styles.infoIcon} />
          <div className={styles.infoText}>
            <strong>How to Set Up Discord Webhooks:</strong> Open your Discord server and go to{" "}
            <strong>Server Settings</strong> → <strong>Integrations</strong> →{" "}
            <strong>Webhooks</strong>. Click <strong>"New Webhook"</strong> and customize it: choose
            the channel, rename it to{" "}
            <strong>
              <i>Docked</i>
            </strong>
            , and optionally use the Docked logo as the avatar (
            <a href="/img/logo.png" download="docked-logo.png" className={styles.downloadLink}>
              Download Logo
            </a>
            ). Copy the webhook URL, then click <strong>"Add Webhook"</strong> below and paste it.
            You can optionally add a server name for easy identification.
          </div>
        </div>
      </Card>

      {discordWebhooks.length > 0 && (
        <div className={styles.webhooksList}>
          {discordWebhooks.map((webhook) => (
            <Card key={webhook.id} variant="default" padding="md" className={styles.webhookCard}>
              <div className={styles.webhookContent}>
                <div className={styles.webhookInfo}>
                  <img
                    src={
                      webhook.avatarUrl ||
                      webhook.avatar_url ||
                      "https://cdn.discordapp.com/embed/avatars/0.png"
                    }
                    alt="Webhook avatar"
                    className={styles.avatar}
                    onError={(e) => {
                      // Fallback to Discord's default webhook avatar if image fails to load
                      const discordDefault = "https://cdn.discordapp.com/embed/avatars/0.png";
                      if (e.target.src !== discordDefault) {
                        e.target.src = discordDefault;
                      }
                    }}
                  />
                  <div className={styles.webhookDetails}>
                    <strong className={styles.serverName}>
                      {webhook.serverName || "Unnamed Server"}
                    </strong>
                    {webhook.channelName && (
                      <div className={styles.channelName}>Channel: {webhook.channelName}</div>
                    )}
                    <div className={styles.webhookMeta}>
                      {webhook.enabled ? (
                        <span className={styles.statusEnabled}>✓ Enabled</span>
                      ) : (
                        <span className={styles.statusDisabled}>✗ Disabled</span>
                      )}
                      {webhook.updatedAt && (
                        <span className={styles.lastUpdated}>
                          • Last updated: {new Date(webhook.updatedAt).toLocaleDateString()}
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
          Maximum of 3 webhooks reached. Remove an existing webhook to add a new one.
        </p>
      )}

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

import React from "react";
import PropTypes from "prop-types";
import Input from "../../ui/Input";
import styles from "../ImportCredentialsModal.module.css";

/**
 * DiscordCredentialsStep Component
 * Step component for collecting Discord webhook URLs
 */
function DiscordCredentialsStep({ webhooks, credentials, errors, onUpdateCredential }) {
  return (
    <div className={styles.stepContent}>
      <h3 className={styles.stepTitle}>Discord Webhooks</h3>
      <p className={styles.stepDescription}>Enter webhook URLs for each Discord server.</p>

      {webhooks.map((webhook, index) => {
        const cred = credentials.discordWebhooks?.[index] || {};

        return (
          <div key={webhook.id || index} className={styles.instanceCard}>
            <div className={styles.instanceHeader}>
              <h4 className={styles.instanceName}>
                {webhook.server_name || `Webhook ${index + 1}`}
              </h4>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Webhook URL</label>
              <Input
                type="url"
                value={cred.webhookUrl || ""}
                onChange={(e) => onUpdateCredential(index, "webhookUrl", e.target.value)}
                placeholder="https://discord.com/api/webhooks/{id}/{token}"
                error={errors[`discord_${index}_webhookUrl`]}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

DiscordCredentialsStep.propTypes = {
  webhooks: PropTypes.arrayOf(PropTypes.object).isRequired,
  credentials: PropTypes.object.isRequired,
  errors: PropTypes.object.isRequired,
  onUpdateCredential: PropTypes.func.isRequired,
};

export default DiscordCredentialsStep;

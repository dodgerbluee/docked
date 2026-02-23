import React from "react";
import PropTypes from "prop-types";
import Card from "../ui/Card";
import ActionButtons from "../ui/ActionButtons";
import styles from "./SSOProviderCard.module.css";

/**
 * SSOProviderCard Component
 * Displays a single SSO provider's information with edit/delete actions.
 */
const SSOProviderCard = React.memo(function SSOProviderCard({ provider, onEdit, onDelete }) {
  return (
    <Card variant="default" padding="md" className={styles.card}>
      <div className={styles.cardContent}>
        <div className={styles.providerInfo}>
          <div className={styles.providerHeader}>
            <span className={styles.providerName}>{provider.displayName}</span>
            <span className={styles.typeBadge}>{provider.providerType}</span>
            {provider.enabled ? (
              <span className={styles.statusEnabled}>Enabled</span>
            ) : (
              <span className={styles.statusDisabled}>Disabled</span>
            )}
          </div>
          <div className={styles.providerDetails}>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Slug:</span>
              <span className={styles.detailValue}>{provider.name}</span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Issuer:</span>
              <span className={styles.detailValue}>{provider.issuerUrl}</span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Client ID:</span>
              <span className={styles.detailValue}>{provider.clientId}</span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Secret:</span>
              <span className={styles.detailValue}>{provider.clientSecret}</span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Auto-register:</span>
              <span className={styles.detailValue}>
                {provider.autoRegister ? "Yes" : "No"}
              </span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Default role:</span>
              <span className={styles.detailValue}>{provider.defaultRole}</span>
            </div>
          </div>
        </div>
        <ActionButtons onEdit={onEdit} onDelete={onDelete} />
      </div>
    </Card>
  );
});

SSOProviderCard.propTypes = {
  provider: PropTypes.shape({
    id: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
    displayName: PropTypes.string.isRequired,
    providerType: PropTypes.string.isRequired,
    clientId: PropTypes.string.isRequired,
    clientSecret: PropTypes.string.isRequired,
    issuerUrl: PropTypes.string.isRequired,
    autoRegister: PropTypes.bool.isRequired,
    defaultRole: PropTypes.string.isRequired,
    enabled: PropTypes.bool.isRequired,
  }).isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};

export default SSOProviderCard;

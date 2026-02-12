import styles from './IntentCard.module.css';

/**
 * IntentCard - Display a single auto-update intent
 * 
 * Props:
 * - intent: {id, imageRepo, stackName, serviceName, containerName, description, enabled, created_at}
 * - onTestMatch: () => void
 * - onEnable: () => void
 * - onDisable: () => void
 * - onDelete: () => void
 */
export default function IntentCard({
  intent,
  onTestMatch,
  onEnable,
  onDisable,
  onDelete,
}) {
  const getMatchingCriteria = () => {
    if (intent.stackName && intent.serviceName) {
      return {
        label: 'Stack + Service',
        value: `${intent.stackName} / ${intent.serviceName}`,
      };
    }
    if (intent.imageRepo) {
      return {
        label: 'Image Repository',
        value: intent.imageRepo,
      };
    }
    if (intent.containerName) {
      return {
        label: 'Container Name',
        value: intent.containerName,
      };
    }
    return { label: 'Unknown', value: 'N/A' };
  };

  const criteria = getMatchingCriteria();
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>
          {intent.description || `Intent ${intent.id}`}
        </h3>
        <span
          className={`${styles.statusBadge} ${
            intent.enabled ? styles.enabled : styles.disabled
          }`}
        >
          {intent.enabled ? '✓ Enabled' : 'Disabled'}
        </span>
      </div>

      <div className={styles.cardContent}>
        <div className={styles.criteriaGroup}>
          <label className={styles.criteriaLabel}>{criteria.label}</label>
          <div className={styles.criteriaValue}>{criteria.value}</div>
        </div>

        {intent.description && (
          <div className={styles.descriptionGroup}>
            <p className={styles.description}>{intent.description}</p>
          </div>
        )}

        <div className={styles.metadata}>
          <span className={styles.metaItem}>
            Created: {formatDate(intent.created_at)}
          </span>
        </div>
      </div>

      <div className={styles.cardActions}>
        <button
          className={`${styles.actionButton} ${styles.secondary}`}
          onClick={onTestMatch}
          title="Test which containers will match this intent"
        >
          🧪 Test Match
        </button>

        {intent.enabled ? (
          <button
            className={`${styles.actionButton} ${styles.danger}`}
            onClick={onDisable}
            title="Disable auto-updates for this intent"
          >
            ⏸ Disable
          </button>
        ) : (
          <button
            className={`${styles.actionButton} ${styles.primary}`}
            onClick={onEnable}
            title="Enable auto-updates for this intent"
          >
            ▶ Enable
          </button>
        )}

        <button
          className={`${styles.actionButton} ${styles.danger}`}
          onClick={onDelete}
          title="Delete this intent"
        >
          🗑 Delete
        </button>
      </div>
    </div>
  );
}

import styles from './IntentList.module.css';
import IntentCard from './IntentCard';

/**
 * IntentList - Display list of auto-update intents
 * 
 * Props:
 * - intents: Array of intent objects
 * - loading: Boolean indicating if data is being fetched
 * - onTestMatch: (intent) => void - Called when user clicks "Test Match"
 * - onEnable: (id) => void - Called when user enables intent
 * - onDisable: (id) => void - Called when user disables intent
 * - onDelete: (id) => void - Called when user deletes intent
 * - onRefresh: () => void - Called when user clicks refresh
 */
export default function IntentList({
  intents,
  loading,
  onTestMatch,
  onEnable,
  onDisable,
  onDelete,
  onRefresh,
}) {
  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingState}>
          <div className={styles.spinner} />
          <p>Loading auto-update intents...</p>
        </div>
      </div>
    );
  }

  if (!intents || intents.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📋</div>
          <h2>No Auto-Update Intents Yet</h2>
          <p>Create your first intent to automatically upgrade containers.</p>
          <p className={styles.emptySubtext}>
            Choose matching criteria (image repo, stack+service, or container name) and enable auto-updates.
          </p>
        </div>
      </div>
    );
  }

  // Sort intents: enabled first, then by created_at descending
  const sortedIntents = [...intents].sort((a, b) => {
    if (a.enabled !== b.enabled) {
      return a.enabled ? -1 : 1;
    }
    return new Date(b.created_at) - new Date(a.created_at);
  });

  return (
    <div className={styles.container}>
      <div className={styles.listHeader}>
        <span className={styles.intentCount}>
          {intents.length} {intents.length === 1 ? 'intent' : 'intents'}
        </span>
        <button
          className={styles.refreshButton}
          onClick={onRefresh}
          title="Refresh list"
        >
          🔄 Refresh
        </button>
      </div>

      <div className={styles.intentsList}>
        {sortedIntents.map((intent) => (
          <IntentCard
            key={intent.id}
            intent={intent}
            onTestMatch={() => onTestMatch(intent)}
            onEnable={() => onEnable(intent.id)}
            onDisable={() => onDisable(intent.id)}
            onDelete={() => onDelete(intent.id)}
          />
        ))}
      </div>
    </div>
  );
}

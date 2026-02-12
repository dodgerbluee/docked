import styles from './TestMatchModal.module.css';

/**
 * TestMatchModal - Show test-match results (dry-run)
 * 
 * Props:
 * - isOpen: boolean
 * - intent: {id, description, ...}
 * - results: {matchedCount, withUpdatesCount, matchedContainers: [...]}
 * - onClose: () => void
 * - onEnable: () => Promise<void>
 */
export default function TestMatchModal({
  isOpen,
  intent,
  results,
  onClose,
  onEnable,
}) {
  if (!isOpen || !results) return null;

  const hasMatches = results.matchedCount > 0;
  const hasUpdates = results.withUpdatesCount > 0;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Test Match Results</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <div className={styles.content}>
          {!hasMatches ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>🔍</div>
              <h3>No Containers Matched</h3>
              <p>
                No containers matched your criteria. Try a different matching criterion.
              </p>
            </div>
          ) : (
            <>
              <div className={styles.summary}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Containers Found</span>
                  <span className={styles.summaryValue}>
                    {results.matchedCount}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Have Updates</span>
                  <span
                    className={`${styles.summaryValue} ${
                      hasUpdates ? styles.hasUpdates : styles.noUpdates
                    }`}
                  >
                    {results.withUpdatesCount}
                  </span>
                </div>
              </div>

              <div className={styles.tableContainer}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Container Name</th>
                      <th>Image Repository</th>
                      <th>Update Available</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.matchedContainers.map((container, idx) => (
                      <tr key={idx}>
                        <td className={styles.nameCell}>
                          <code>{container.name}</code>
                        </td>
                        <td className={styles.imageCell}>
                          <code>{container.imageRepo}</code>
                        </td>
                        <td className={styles.updateCell}>
                          {container.hasUpdate ? (
                            <>
                              <span className={styles.badge + ' ' + styles.available}>
                                Available
                              </span>
                              {container.updateAvailable && (
                                <span className={styles.version}>
                                  v{container.updateAvailable}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className={styles.badge + ' ' + styles.current}>
                              Current
                            </span>
                          )}
                        </td>
                        <td className={styles.statusCell}>
                          {container.hasUpdate ? (
                            <span className={styles.statusWillUpgrade}>
                              ✓ Will upgrade
                            </span>
                          ) : (
                            <span className={styles.statusNoAction}>No action</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {hasUpdates && (
                <div className={styles.infoBox}>
                  <span className={styles.infoIcon}>ℹ️</span>
                  <span>
                    When enabled, the batch job will upgrade {results.withUpdatesCount}{' '}
                    container{results.withUpdatesCount !== 1 ? 's' : ''}.
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.secondaryButton} onClick={onClose}>
            Close
          </button>
          {hasMatches && (
            <button className={styles.primaryButton} onClick={onEnable}>
              ✓ Enable Auto-Updates
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

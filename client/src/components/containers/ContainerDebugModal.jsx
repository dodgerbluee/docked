import React, { useEffect, useId, useState } from "react";
import PropTypes from "prop-types";
import { AlertCircle, ChevronRight, Database, History, Package, RefreshCw, X } from "lucide-react";
import { graphqlClient } from "../../graphql/client";
import { CONTAINER_DETAILS_QUERY } from "../../graphql/queries";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import LoadingSpinner from "../ui/LoadingSpinner";
import styles from "./ContainerDebugModal.module.css";

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function recordValue(value) {
  if (value == null) return <span className={styles.nullValue}>null</span>;
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

function RecordSection({ title, records, icon: Icon = Database }) {
  if (!records) return null;
  const isList = Array.isArray(records);
  const rows = isList ? records : [records];
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return (
    <details className={styles.section}>
      <summary className={styles.sectionHeader} tabIndex={0}>
        <span className={styles.sectionTitle}>
          <ChevronRight size={20} className={styles.chevron} aria-hidden="true" />
          <Icon size={20} className={styles.sectionIcon} aria-hidden="true" />
          {title}
          {isList && rows.length > 0 && <span>({rows.length})</span>}
        </span>
      </summary>
      <div className={styles.sectionContent}>
        {rows.length === 0 ? (
          <p className={styles.emptyMessage}>No records found</p>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.dataTable} aria-label={title}>
              <thead>
                <tr>
                  {(isList ? columns : ["Field", "Value"]).map((column) => (
                    <th scope="col" key={column}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isList
                  ? rows.map((row, i) => (
                      <tr key={row.id ?? i} className={i === 0 ? styles.highlightedRow : undefined}>
                        {columns.map((column) => (
                          <td key={column} className={styles.fieldValue}>
                            {recordValue(row[column])}
                          </td>
                        ))}
                      </tr>
                    ))
                  : Object.entries(records).map(([field, value]) => (
                      <tr key={field}>
                        <th scope="row" className={styles.fieldName}>
                          {field}
                        </th>
                        <td className={styles.fieldValue}>{recordValue(value)}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}

RecordSection.propTypes = {
  title: PropTypes.string.isRequired,
  records: PropTypes.oneOfType([PropTypes.array, PropTypes.object]),
  icon: PropTypes.elementType,
};

// Restores the original Container Details inspector removed in 3a21017.
// The GraphQL replacement includes runner identity on every lookup.
export default function ContainerDebugModal({ container, onClose, developerModeEnabled = false }) {
  const titleId = useId();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setInfo(null);
    const load = async () => {
      try {
        if (!container.id || !container.runnerId)
          throw new Error("Container runner identity is missing.");
        const result = await graphqlClient
          .query(CONTAINER_DETAILS_QUERY, {
            containerId: String(container.id),
            runnerId: String(container.runnerId),
          })
          .toPromise();
        if (result.error) throw result.error;
        if (!result.data?.containerDetails)
          throw new Error("Container no longer exists or is unavailable.");
        if (active) setInfo(result.data.containerDetails);
      } catch (err) {
        if (active) setError(err.message || "Unable to load container details.");
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [container.id, container.runnerId, revision]);

  const currentDigests = info?.repoDigests?.length
    ? info.repoDigests
    : [info?.currentDigest].filter(Boolean);
  return (
    <Modal
      isOpen
      onClose={onClose}
      showCloseButton={false}
      aria-labelledby={titleId}
      className={styles.modalContainer}
      contentClassName={styles.modalContent}
      overlayClassName={styles.modalOverlay}
      size="xl"
    >
      <header className={styles.modalHeader}>
        <div className={styles.headerContent}>
          <Database size={24} className={styles.headerIcon} aria-hidden="true" />
          <h2 id={titleId} className={styles.modalTitle}>
            Container Details
          </h2>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconButton}
            disabled={loading}
            onClick={() => setRevision((v) => v + 1)}
            aria-label="Refresh data"
            title="Refresh data"
          >
            <RefreshCw
              size={18}
              className={loading ? styles.spinning : undefined}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className={styles.modalBody} aria-busy={loading}>
        {loading && (
          <div className={styles.loadingState}>
            <LoadingSpinner />
            <p className={styles.loadingText}>Loading container details...</p>
          </div>
        )}
        {error && (
          <div className={styles.errorState} role="alert">
            <AlertCircle size={48} className={styles.errorIcon} aria-hidden="true" />
            <h3 className={styles.errorTitle}>Unable to load container details</h3>
            <p className={styles.errorMessage}>{error}</p>
            <Button variant="secondary" icon={RefreshCw} onClick={() => setRevision((v) => v + 1)}>
              Try Again
            </Button>
          </div>
        )}
        {info && (
          <>
            <div className={styles.topSection}>
              <section className={styles.metadataCard} aria-label="Container information">
                <h3 className={styles.cardTitle}>Container Information</h3>
                <dl className={styles.metadataGrid}>
                  {Object.entries({
                    "Container Name": info.container?.container_name || container.name,
                    Runner: info.container?.runner_name,
                    "Container ID": container.id,
                    "Queried At": formatDate(info.metadata?.queried_at),
                    Image: info.container?.image,
                    State: info.container?.state,
                    Stack: info.container?.stackName,
                  }).map(([label, value]) => (
                    <div
                      className={`${styles.metadataItem} ${label === "Image" ? styles.metadataImage : ""}`}
                      key={label}
                    >
                      <dt className={styles.metadataLabel}>{label}</dt>
                      <dd
                        className={`${styles.metadataValue} ${label === "Container ID" ? styles.monoValue : ""}`}
                      >
                        {value || <span className={styles.nullValue}>Not available</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className={styles.comparisonCard} aria-label="Image digest comparison">
                <h3 className={styles.cardTitle}>Image Digest Comparison</h3>
                <div className={styles.comparisonGrid}>
                  <div className={styles.digestColumn}>
                    <div className={styles.digestHeader}>
                      <h4 className={styles.digestLabel}>Current (Deployed)</h4>
                      {currentDigests.length > 1 && (
                        <span className={styles.countBadge}>{currentDigests.length} digests</span>
                      )}
                    </div>
                    <div className={styles.digestBox}>
                      {currentDigests.length ? (
                        <div className={styles.digestList}>
                          {currentDigests.map((digest) => (
                            <code className={styles.digestCode} key={digest}>
                              {digest}
                            </code>
                          ))}
                        </div>
                      ) : (
                        <span className={styles.nullValue}>Not available</span>
                      )}
                    </div>
                  </div>
                  <div className={styles.vsDivider}>
                    <span className={styles.vsText}>VS</span>
                  </div>
                  <div className={styles.digestColumn}>
                    <div className={styles.digestHeader}>
                      <h4 className={styles.digestLabel}>Registry (Latest)</h4>
                      {info.hasUpdate && (
                        <span className={styles.updateBadge}>Update Available</span>
                      )}
                    </div>
                    <div
                      className={`${styles.digestBox} ${info.hasUpdate ? styles.digestBoxUpdated : ""}`}
                    >
                      {info.latestDigest ? (
                        <code className={styles.digestCode}>{info.latestDigest}</code>
                      ) : (
                        <span className={styles.nullValue}>Not available</span>
                      )}
                    </div>
                  </div>
                </div>
                <dl className={styles.providerInfo}>
                  <div className={styles.providerItem}>
                    <dt className={styles.providerLabel}>Provider</dt>
                    <dd className={styles.providerValue}>
                      {info.registryImageVersion?.provider || "Not available"}
                    </dd>
                  </div>
                  <div className={styles.providerItem}>
                    <dt className={styles.providerLabel}>Last Checked</dt>
                    <dd className={styles.providerValue}>
                      {formatDate(info.registryImageVersion?.last_checked)}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
            <div className={styles.sectionsContainer}>
              <RecordSection title="Upgrade History" records={info.upgradeHistory} icon={History} />
              {developerModeEnabled && (
                <>
                  <div className={styles.debuggingHeader}>
                    <Database size={20} className={styles.debuggingIcon} aria-hidden="true" />
                    <h3 className={styles.debuggingTitle}>Debugging</h3>
                    <span className={styles.debuggingBadge}>Developer Mode</span>
                  </div>
                  <RecordSection
                    title="Container Record"
                    records={info.containerRecords?.[0] || info.container}
                  />
                  <RecordSection
                    title="Current Deployed Image"
                    records={info.deployedImage}
                    icon={Package}
                  />
                  <RecordSection
                    title="All Deployed Images for this Image/Tag"
                    records={info.allDeployedImages}
                    icon={Package}
                  />
                  <RecordSection
                    title="Registry Image Version"
                    records={info.registryImageVersion}
                  />
                  <RecordSection
                    title="All Registry Image Versions for this Image"
                    records={info.allRegistryImageVersions}
                  />
                  <RecordSection
                    title="Containers With Same Name"
                    records={info.allContainersWithSameName}
                    icon={AlertCircle}
                  />
                </>
              )}
            </div>
            <footer className={styles.modalFooter}>
              <p className={styles.footerNote}>
                Showing up to 20 upgrades
                {developerModeEnabled ? " and 100 records per related section" : ""}. Press{" "}
                <kbd className={styles.kbd}>Esc</kbd> to close.
              </p>
            </footer>
          </>
        )}
      </div>
    </Modal>
  );
}

ContainerDebugModal.propTypes = {
  container: PropTypes.object.isRequired,
  onClose: PropTypes.func.isRequired,
  developerModeEnabled: PropTypes.bool,
};

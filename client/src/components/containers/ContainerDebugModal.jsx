import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { graphqlClient } from "../../graphql/client";
import { CONTAINER_DETAILS_QUERY } from "../../graphql/queries";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import LoadingSpinner from "../ui/LoadingSpinner";
import styles from "./ContainerDebugModal.module.css";

function RecordSection({ title, records, open = false }) {
  if (!records) return null;
  const rows = Array.isArray(records) ? records : [records];
  return (
    <details className={styles.section} open={open || undefined}>
      <summary className={styles.sectionHeader}>
        {title} ({rows.length})
      </summary>
      <div className={styles.sectionContent}>
        {rows.length === 0 ? (
          <p>No records found.</p>
        ) : (
          rows.map((row, i) => (
            <div className={styles.tableWrapper} key={row.id ?? i}>
              <table className={styles.dataTable} aria-label={`${title} record ${i + 1}`}>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(row).map(([field, value]) => (
                    <tr key={field}>
                      <th scope="row" className={styles.fieldName}>
                        {field}
                      </th>
                      <td className={styles.fieldValue}>
                        {value == null
                          ? "Not available"
                          : typeof value === "object"
                            ? JSON.stringify(value)
                            : String(value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
    </details>
  );
}

RecordSection.propTypes = {
  title: PropTypes.string.isRequired,
  records: PropTypes.oneOfType([PropTypes.array, PropTypes.object]),
  open: PropTypes.bool,
};

// Restores the original Container Details inspector removed in 3a21017.
// The GraphQL replacement includes runner identity on every lookup.
export default function ContainerDebugModal({ container, onClose, developerModeEnabled = false }) {
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
    <Modal isOpen onClose={onClose} title="Container Details" size="xl" fullScreenMobile>
      <Button
        variant="secondary"
        size="sm"
        disabled={loading}
        onClick={() => setRevision((v) => v + 1)}
      >
        Refresh data
      </Button>
      {loading && <LoadingSpinner message="Loading container details..." />}
      {error && <p role="alert">{error}</p>}
      {info && (
        <>
          <div className={styles.topSection}>
            <div className={styles.metadataCard}>
              <h3 className={styles.cardTitle}>Container Information</h3>
              <dl className={styles.metadataGrid}>
                {Object.entries({
                  "Container Name": info.container?.container_name || container.name,
                  Runner: info.container?.runner_name,
                  "Container ID": container.id,
                  Image: info.container?.image,
                  State: info.container?.state,
                  Stack: info.container?.stackName,
                  "Queried At": info.metadata?.queried_at,
                }).map(([label, value]) => (
                  <div className={styles.metadataItem} key={label}>
                    <dt className={styles.metadataLabel}>{label}</dt>
                    <dd className={styles.metadataValue}>{value || "Not available"}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className={styles.comparisonCard}>
              <h3 className={styles.cardTitle}>Image Digest Comparison</h3>
              <div className={styles.comparisonGrid}>
                <div className={styles.digestColumn}>
                  <h4 className={styles.digestLabel}>Current (Deployed)</h4>
                  <div className={styles.digestBox}>
                    {currentDigests.length
                      ? currentDigests.map((digest) => (
                          <code className={styles.digestCode} key={digest}>
                            {digest}
                          </code>
                        ))
                      : "Not available"}
                  </div>
                </div>
                <div className={styles.vsDivider}>VS</div>
                <div className={styles.digestColumn}>
                  <h4 className={styles.digestLabel}>Registry (Latest)</h4>
                  {info.hasUpdate && <span className={styles.updateBadge}>Update Available</span>}
                  <div className={styles.digestBox}>
                    {info.latestDigest ? (
                      <code className={styles.digestCode}>{info.latestDigest}</code>
                    ) : (
                      "Not available"
                    )}
                  </div>
                </div>
              </div>
              <div className={styles.providerInfo}>
                <p>Provider: {info.registryImageVersion?.provider || "Not available"}</p>
                <p>Last Checked: {info.registryImageVersion?.last_checked || "Not available"}</p>
              </div>
            </div>
          </div>
          <RecordSection title="Upgrade History" records={info.upgradeHistory} />
          <p>
            Showing up to 20 upgrades
            {developerModeEnabled ? " and 100 records per related section" : ""}.
          </p>
          {developerModeEnabled && (
            <>
              <RecordSection title="Container Record" records={info.containerRecords} />
              <RecordSection title="Deployed Image" records={info.deployedImage} />
              <RecordSection title="All Deployed Images" records={info.allDeployedImages} />
              <RecordSection title="Registry Image Version" records={info.registryImageVersion} />
              <RecordSection
                title="All Registry Image Versions"
                records={info.allRegistryImageVersions}
              />
              <RecordSection
                title="Containers With Same Name"
                records={info.allContainersWithSameName}
              />
            </>
          )}
        </>
      )}
    </Modal>
  );
}

ContainerDebugModal.propTypes = {
  container: PropTypes.object.isRequired,
  onClose: PropTypes.func.isRequired,
  developerModeEnabled: PropTypes.bool,
};

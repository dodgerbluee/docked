/**
 * UpgradeHistoryDetailModal Component
 * Shows detailed information about a specific upgrade
 */

import React from "react";
import PropTypes from "prop-types";
import { CheckCircle2, XCircle, Clock, Package, Server, Tag, Hash } from "lucide-react";
import Modal from "../ui/Modal";
import styles from "./UpgradeHistoryDetailModal.module.css";

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms) {
  if (!ms) return "N/A";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format date to readable string
 */
function formatDate(dateString) {
  if (!dateString) return "Unknown";
  const date = new Date(dateString);
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

/**
 * Get short digest for display
 */
function getShortDigest(digest) {
  if (!digest) return "N/A";
  if (digest.startsWith("sha256:")) {
    return digest.substring(7, 19);
  }
  return digest.substring(0, 12);
}

function UpgradeHistoryDetailModal({ upgrade, isOpen, onClose }) {
  if (!upgrade) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Upgrade Details" size="large">
      <div className={styles.modalContent}>
        {/* Status Header */}
        <div
          className={`${styles.statusHeader} ${
            upgrade.status === "success" ? styles.statusSuccess : styles.statusFailed
          }`}
        >
          {upgrade.status === "success" ? (
            <CheckCircle2 size={24} className={styles.statusIcon} />
          ) : (
            <XCircle size={24} className={styles.statusIcon} />
          )}
          <div className={styles.statusContent}>
            <div className={styles.statusTitle}>
              {upgrade.status === "success" ? "Upgrade Successful" : "Upgrade Failed"}
            </div>
            <div className={styles.statusSubtitle}>{upgrade.container_name}</div>
          </div>
        </div>

        {/* Main Info Grid */}
        <div className={styles.infoGrid}>
          {/* Container Info */}
          <div className={styles.infoSection}>
            <h3 className={styles.sectionTitle}>
              <Package size={18} />
              Container Information
            </h3>
            <div className={styles.infoList}>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Container Name:</span>
                <span className={styles.infoValue}>{upgrade.container_name}</span>
              </div>
              {upgrade.portainer_instance_name && (
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Portainer Instance:</span>
                  <span className={styles.infoValue}>{upgrade.portainer_instance_name}</span>
                </div>
              )}
              {upgrade.portainer_url && (
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Portainer URL:</span>
                  <span className={styles.infoValue}>{upgrade.portainer_url}</span>
                </div>
              )}
              {upgrade.endpoint_id && (
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Endpoint ID:</span>
                  <span className={styles.infoValue}>{upgrade.endpoint_id}</span>
                </div>
              )}
            </div>
          </div>

          {/* Image Changes */}
          <div className={styles.infoSection}>
            <h3 className={styles.sectionTitle}>
              <Tag size={18} />
              Image Changes
            </h3>
            <div className={styles.imageComparison}>
              <div className={styles.imageBox}>
                <div className={styles.imageBoxHeader}>Previous Image</div>
                <div className={styles.imageBoxContent}>
                  <div className={styles.imageName}>{upgrade.old_image}</div>
                  {upgrade.old_version && (
                    <div className={styles.imageVersion}>
                      <span className={styles.versionLabel}>Version:</span>
                      {upgrade.old_version}
                    </div>
                  )}
                  {upgrade.old_digest && (
                    <div className={styles.imageDigest}>
                      <Hash size={14} />
                      <code>{getShortDigest(upgrade.old_digest)}</code>
                    </div>
                  )}
                </div>
              </div>
              <div className={styles.arrow}>→</div>
              <div className={styles.imageBox}>
                <div className={styles.imageBoxHeader}>New Image</div>
                <div className={styles.imageBoxContent}>
                  <div className={styles.imageName}>{upgrade.new_image}</div>
                  {upgrade.new_version && (
                    <div className={styles.imageVersion}>
                      <span className={styles.versionLabel}>Version:</span>
                      {upgrade.new_version}
                    </div>
                  )}
                  {upgrade.new_digest && (
                    <div className={styles.imageDigest}>
                      <Hash size={14} />
                      <code>{getShortDigest(upgrade.new_digest)}</code>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Registry Info */}
          {(upgrade.registry || upgrade.image_repo) && (
            <div className={styles.infoSection}>
              <h3 className={styles.sectionTitle}>
                <Server size={18} />
                Registry Information
              </h3>
              <div className={styles.infoList}>
                {upgrade.registry && (
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>Registry:</span>
                    <span className={styles.infoValue}>{upgrade.registry}</span>
                  </div>
                )}
                {upgrade.namespace && (
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>Namespace:</span>
                    <span className={styles.infoValue}>{upgrade.namespace}</span>
                  </div>
                )}
                {upgrade.repository && (
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>Repository:</span>
                    <span className={styles.infoValue}>{upgrade.repository}</span>
                  </div>
                )}
                {upgrade.image_repo && (
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>Image Repo:</span>
                    <span className={styles.infoValue}>{upgrade.image_repo}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Timing Info */}
          <div className={styles.infoSection}>
            <h3 className={styles.sectionTitle}>
              <Clock size={18} />
              Timing Information
            </h3>
            <div className={styles.infoList}>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Upgraded At:</span>
                <span className={styles.infoValue}>{formatDate(upgrade.created_at)}</span>
              </div>
              {upgrade.upgrade_duration_ms && (
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Duration:</span>
                  <span className={styles.infoValue}>
                    {formatDuration(upgrade.upgrade_duration_ms)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Error Message (if failed) */}
          {upgrade.status === "failed" && upgrade.error_message && (
            <div className={styles.infoSection}>
              <h3 className={styles.sectionTitle}>
                <XCircle size={18} />
                Error Details
              </h3>
              <div className={styles.errorMessage}>{upgrade.error_message}</div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

UpgradeHistoryDetailModal.propTypes = {
  upgrade: PropTypes.object,
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default UpgradeHistoryDetailModal;

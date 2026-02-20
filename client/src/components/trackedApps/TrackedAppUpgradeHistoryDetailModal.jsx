/**
 * TrackedAppUpgradeHistoryDetailModal Component
 * Shows detailed information about a specific tracked app upgrade
 */

import React from "react";
import PropTypes from "prop-types";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Github,
  Gitlab,
  Tag,
  Hash,
  Package,
  FileText,
} from "lucide-react";
import Modal from "../ui/Modal";
import styles from "./TrackedAppUpgradeHistoryDetailModal.module.css";

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
 * Get provider icon
 */
function getProviderIcon(provider) {
  switch (provider) {
    case "github":
      return Github;
    case "gitlab":
      return Gitlab;
    case "docker":
      return Package;
    default:
      return Tag;
  }
}

function TrackedAppUpgradeHistoryDetailModal({ upgrade, isOpen, onClose }) {
  if (!upgrade) return null;

  const ProviderIcon = getProviderIcon(upgrade.provider);

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
            <div className={styles.statusSubtitle}>{upgrade.app_name}</div>
          </div>
        </div>

        {/* Main Info Grid */}
        <div className={styles.infoGrid}>
          {/* App Info */}
          <div className={styles.infoSection}>
            <h3 className={styles.sectionTitle}>
              <ProviderIcon size={18} />
              Application Information
            </h3>
            <div className={styles.infoList}>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>App Name:</span>
                <span className={styles.infoValue}>{upgrade.app_name}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Provider:</span>
                <span className={styles.infoValue} style={{ textTransform: "capitalize" }}>
                  {upgrade.provider}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Repository:</span>
                <span className={styles.infoValue}>{upgrade.repository}</span>
              </div>
            </div>
          </div>

          {/* Version Changes */}
          <div className={styles.infoSection}>
            <h3 className={styles.sectionTitle}>
              <Tag size={18} />
              Version Changes
            </h3>
            <div className={styles.imageComparison}>
              <div className={styles.imageBox}>
                <div className={styles.imageBoxHeader}>Previous Version</div>
                <div className={styles.imageBoxContent}>
                  <div className={styles.imageName}>{upgrade.old_version}</div>
                  {upgrade.old_tag && upgrade.old_tag !== upgrade.old_version && (
                    <div className={styles.imageVersion}>
                      <span className={styles.versionLabel}>Tag:</span>
                      {upgrade.old_tag}
                    </div>
                  )}
                  {upgrade.old_commit_sha && (
                    <div className={styles.imageDigest}>
                      <Hash size={14} />
                      <code>{upgrade.old_commit_sha.substring(0, 12)}</code>
                    </div>
                  )}
                </div>
              </div>
              <div className={styles.arrow}>→</div>
              <div className={styles.imageBox}>
                <div className={styles.imageBoxHeader}>New Version</div>
                <div className={styles.imageBoxContent}>
                  <div className={styles.imageName}>{upgrade.new_version}</div>
                  {upgrade.new_tag && upgrade.new_tag !== upgrade.new_version && (
                    <div className={styles.imageVersion}>
                      <span className={styles.versionLabel}>Tag:</span>
                      {upgrade.new_tag}
                    </div>
                  )}
                  {upgrade.new_commit_sha && (
                    <div className={styles.imageDigest}>
                      <Hash size={14} />
                      <code>{upgrade.new_commit_sha.substring(0, 12)}</code>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Release Notes */}
          {upgrade.release_notes && (
            <div className={styles.infoSection}>
              <h3 className={styles.sectionTitle}>
                <FileText size={18} />
                Release Notes
              </h3>
              <div className={styles.errorMessage}>{upgrade.release_notes}</div>
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

TrackedAppUpgradeHistoryDetailModal.propTypes = {
  upgrade: PropTypes.object,
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default TrackedAppUpgradeHistoryDetailModal;

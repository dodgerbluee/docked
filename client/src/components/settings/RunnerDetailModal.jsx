import React, { useState, useCallback } from "react";
import PropTypes from "prop-types";
import {
  Pencil,
  Trash2,
  Wifi,
  WifiOff,
  Loader,
  ArrowUpCircle,
  RefreshCw,
  Terminal,
} from "lucide-react";
import axios from "axios";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import { API_BASE_URL } from "../../constants/api";
import { hasVersionUpdate } from "../../utils/versionHelpers";
import styles from "./RunnerDetailModal.module.css";

/**
 * RunnerDetailModal Component
 * Shows runner details with Edit, Delete, and Check for Updates actions.
 * Modeled after InstanceDetailModal.
 */
function RunnerDetailModal({
  runner,
  isOpen,
  onClose,
  onEdit,
  onDelete,
  onUpdate,
  onOperations,
  healthStatus,
  updatingRunner,
  updatedRunners,
  onHealthUpdate,
  onRefreshRunners,
}) {
  const [checking, setChecking] = useState(false);

  const handleCheckForUpdates = useCallback(async () => {
    if (!runner) return;
    setChecking(true);
    try {
      const { data } = await axios.post(`${API_BASE_URL}/api/runners/${runner.id}/health`);
      if (onHealthUpdate) {
        onHealthUpdate(runner.id, {
          online: data.online,
          checking: false,
          health: data.health,
        });
      }
      // Refresh the runners list so version/latest_version fields update
      if (onRefreshRunners) {
        await onRefreshRunners();
      }
    } catch {
      if (onHealthUpdate) {
        onHealthUpdate(runner.id, { online: false, checking: false });
      }
    } finally {
      setChecking(false);
    }
  }, [runner, onHealthUpdate, onRefreshRunners]);

  if (!runner) return null;

  const hs = healthStatus?.[runner.id];
  const liveVersion = hs?.health?.version;
  const dbVersion = runner.version;
  const displayVersion = liveVersion || dbVersion;
  const cleanVersion = displayVersion ? displayVersion.replace(/^v/, "") : null;

  const showUpdateBanner =
    runner.version &&
    runner.latest_version &&
    hasVersionUpdate(runner.version, runner.latest_version) &&
    !updatedRunners?.has(runner.id);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={runner.name || "Runner Details"}
      size="sm"
      fullScreenMobile
    >
      <div className={styles.modalBody}>
        <div className={styles.detailSection}>
          {/* Status */}
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Status</span>
            <span className={styles.detailValue}>
              {hs?.checking ? (
                <span className={`${styles.statusBadge} ${styles.statusChecking}`}>
                  Checking...
                </span>
              ) : hs ? (
                <span
                  className={`${styles.statusBadge} ${hs.online ? styles.statusOnline : styles.statusOffline}`}
                >
                  {hs.online ? <Wifi size={12} /> : <WifiOff size={12} />}
                  {hs.online ? "Online" : "Offline"}
                </span>
              ) : null}
            </span>
          </div>

          {/* URL */}
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>URL</span>
            <span className={styles.detailValue}>{runner.url}</span>
          </div>

          {/* Version */}
          {cleanVersion && (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Version</span>
              <span className={styles.detailValue}>
                <a
                  href={`https://github.com/dockedapp/dockhand/releases/tag/v${cleanVersion}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.versionBadge}
                  title={`View dockhand v${cleanVersion} release`}
                >
                  v{cleanVersion}
                </a>
              </span>
            </div>
          )}

          {/* Docker connectivity */}
          {hs?.online && hs?.health?.docker !== undefined && (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Docker</span>
              <span className={styles.detailValue}>
                <span
                  className={`${styles.dockerBadge} ${hs.health.docker ? styles.dockerConnected : styles.dockerUnavailable}`}
                >
                  {hs.health.docker ? "Connected" : "Unavailable"}
                </span>
              </span>
            </div>
          )}

          {/* Update banner */}
          {showUpdateBanner && (
            <div className={styles.updateBanner}>
              <ArrowUpCircle size={13} />
              Update available: v{runner.version.replace(/^v/, "")} → v
              {runner.latest_version.replace(/^v/, "")}
              <button
                className={styles.updateBannerBtn}
                onClick={() => onUpdate && onUpdate(runner)}
                disabled={updatingRunner === runner.id}
              >
                {updatingRunner === runner.id ? (
                  <>
                    <Loader size={11} className={styles.spinIcon} /> Updating...
                  </>
                ) : (
                  "Update"
                )}
              </button>
            </div>
          )}

          {/* Check for updates button */}
          <button
            className={styles.checkUpdatesBtn}
            onClick={handleCheckForUpdates}
            disabled={checking}
          >
            {checking ? (
              <>
                <Loader size={13} className={styles.spinIcon} />
                Checking...
              </>
            ) : (
              <>
                <RefreshCw size={13} />
                Check for Updates
              </>
            )}
          </button>

          {/* Operations button */}
          <button
            className={styles.checkUpdatesBtn}
            onClick={() => {
              onClose();
              if (onOperations) onOperations(runner);
            }}
          >
            <Terminal size={13} />
            Operations
          </button>
        </div>

        <div className={styles.footer}>
          <Button
            variant="danger"
            size="sm"
            icon={Trash2}
            onClick={() => {
              onClose();
              if (onDelete) onDelete(runner);
            }}
          >
            Delete
          </Button>
          <div className={styles.footerRight}>
            <button type="button" className={styles.editButton} onClick={() => onEdit(runner)}>
              <Pencil size={16} className={styles.editButtonIcon} />
              <span className={styles.editButtonText}>Edit Runner</span>
            </button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

RunnerDetailModal.propTypes = {
  runner: PropTypes.object,
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func,
  onUpdate: PropTypes.func,
  onOperations: PropTypes.func,
  healthStatus: PropTypes.object,
  updatingRunner: PropTypes.number,
  updatedRunners: PropTypes.instanceOf(Set),
  onHealthUpdate: PropTypes.func,
  onRefreshRunners: PropTypes.func,
};

export default RunnerDetailModal;

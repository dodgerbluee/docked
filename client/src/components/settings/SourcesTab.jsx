/**
 * SourcesTab Component
 * Unified settings tab that merges the former "Containers" (PortainerTab)
 * and "Runners" (RunnerTab) tabs into a single "Sources" view.
 *
 * Shows all connected sources (Portainer instances + dockhand runners) in a
 * mixed card grid with type badges, and provides "Add Source" with a type picker.
 * Portainer-specific sections (Intents, Blocklist, Data Management) appear
 * below the grid when at least one Portainer instance exists.
 */

import React, { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import PropTypes from "prop-types";
import axios from "axios";
import {
  Lock,
  Package,
  Server,
  Wifi,
  WifiOff,
  ArrowUpCircle,
  Plus,
  X,
  Trash2,
  Loader,
  Terminal,
  Clock,
  Play,
  RotateCcw,
} from "lucide-react";
import { API_BASE_URL } from "../../constants/api";
import PortainerIcon from "../icons/PortainerIcon";
import Card from "../ui/Card";
import ConfirmDialog from "../ui/ConfirmDialog";
import Button from "../ui/Button";
import LoadingSpinner from "../ui/LoadingSpinner";
import InstanceDetailModal from "./InstanceDetailModal";
import ContainerBlocklist from "./ContainerBlocklist";
import RunnerDetailModal from "./RunnerDetailModal";
import RunOperationModal from "../ui/RunOperationModal";
import { EnrollmentModal } from "./RunnerTab";
import { hasVersionUpdate } from "../../utils/versionHelpers";
import { useRunnerState } from "../../hooks/useRunnerState";
import styles from "./SourcesTab.module.css";
import runnerStyles from "./RunnerTab.module.css";

const IntentsPage = lazy(() => import("../../pages/IntentsPage"));

/* ── Runner sub-components (imported from RunnerTab for reuse) ─────────── */

// RunnerEditForm — inline edit form for runner name/URL
function RunnerEditForm({ runner, onSave, onCancel, saving }) {
  const [form, setForm] = useState({
    name: runner.name,
    url: runner.url,
    enabled: runner.enabled !== 0,
  });
  const [error, setError] = useState("");

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError("Name is required");
    if (!form.url.trim()) return setError("URL is required");
    try {
      new URL(form.url.trim());
    } catch {
      return setError("Invalid URL format");
    }
    setError("");
    onSave({ name: form.name.trim(), url: form.url.trim(), enabled: form.enabled });
  };

  return (
    <form className={runnerStyles.form} onSubmit={handleSubmit}>
      <div className={runnerStyles.formRow}>
        <label className={runnerStyles.label}>Name</label>
        <input
          className={runnerStyles.input}
          type="text"
          value={form.name}
          onChange={set("name")}
          autoFocus
        />
      </div>
      <div className={runnerStyles.formRow}>
        <label className={runnerStyles.label}>URL</label>
        <input
          className={runnerStyles.input}
          type="url"
          value={form.url}
          onChange={set("url")}
          placeholder="http://192.168.1.100:7777"
        />
      </div>
      {error && <p className={runnerStyles.formError}>{error}</p>}
      <div className={runnerStyles.formActions}>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving..." : "Update Runner"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// OperationsModal — shows runner operations grouped by app
function formatAge(ts) {
  if (!ts) return null;
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/* ── Inline imports for runner modals (re-using RunnerTab CSS) ─────────── */
// We import OperationsModal and DeleteRunnerDialog inline since they're
// private to RunnerTab and not exported. We duplicate them here minimally.

function OperationsModal({ runner, onClose, onRun }) {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const { data } = await axios.get(`${API_BASE_URL}/api/runners/${runner.id}/apps`);
        setApps(data.apps || []);
      } catch (err) {
        setError(err.response?.data?.error || err.message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [runner.id]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalOps = apps.reduce((sum, app) => sum + (app.operations?.length || 0), 0);
  const multiApp = apps.length > 1;

  return (
    <div className={runnerStyles.modalOverlay} onClick={onClose}>
      <div className={runnerStyles.opsModal} onClick={(e) => e.stopPropagation()}>
        <div className={runnerStyles.modalHeader}>
          <div className={runnerStyles.opsModalTitle}>
            <Terminal size={16} />
            <h3 className={runnerStyles.modalTitle}>Operations</h3>
            <span className={runnerStyles.opsModalRunner}>{runner.name}</span>
          </div>
          <div className={runnerStyles.opsModalHeaderActions}>
            <button
              className={runnerStyles.opsRefreshBtn}
              onClick={() => fetchData(true)}
              disabled={refreshing || loading}
              title="Refresh"
            >
              <RotateCcw size={14} className={refreshing ? runnerStyles.spinIcon : undefined} />
            </button>
            <button className={runnerStyles.modalClose} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className={runnerStyles.opsModalMeta}>
          <span>{runner.url}</span>
        </div>

        <div className={runnerStyles.opsModalBody}>
          {loading && <LoadingSpinner size="sm" message="Loading operations..." />}
          {error && <p className={runnerStyles.formError}>{error}</p>}
          {!loading && !error && totalOps === 0 && (
            <p className={runnerStyles.opsEmpty}>No operations configured on this runner.</p>
          )}
          {!loading &&
            apps.map((app) => (
              <React.Fragment key={app.name}>
                {multiApp && <div className={runnerStyles.opsAppGroup}>{app.name}</div>}
                {(app.operations || []).map((op) => {
                  const last = op.lastRun;
                  return (
                    <div key={`${app.name}:${op.name}`} className={runnerStyles.opsModalRow}>
                      <div className={runnerStyles.opsModalOpInfo}>
                        <span className={runnerStyles.opsModalOpName}>{op.label || op.name}</span>
                        {app.description && !multiApp && (
                          <span className={runnerStyles.opsModalOpDesc}>{app.description}</span>
                        )}
                        {last && (
                          <span
                            className={`${runnerStyles.opsModalLastRun} ${last.exitCode === 0 ? runnerStyles.opLastRunOk : runnerStyles.opLastRunFail}`}
                            title={`Exit code: ${last.exitCode}`}
                          >
                            <Clock size={11} />
                            {formatAge(last.startedAt)} · exit {last.exitCode}
                          </span>
                        )}
                      </div>
                      <button
                        className={runnerStyles.opRunBtn}
                        onClick={() => onRun(runner, app.name, op.name)}
                        title={`Run ${op.label || op.name}`}
                      >
                        <Play size={12} />
                        Run
                      </button>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
        </div>

        <div className={runnerStyles.modalFooter}>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function DeleteRunnerDialog({ runner, onClose, onDeleted }) {
  const [uninstall, setUninstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      if (uninstall) {
        await axios.post(`${API_BASE_URL}/api/runners/${runner.id}/uninstall`);
      } else {
        await axios.delete(`${API_BASE_URL}/api/runners/${runner.id}`);
      }
      onDeleted();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setBusy(false);
    }
  };

  return (
    <div className={runnerStyles.modalOverlay} onClick={onClose}>
      <div
        className={runnerStyles.modal}
        style={{ maxWidth: 440 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={runnerStyles.modalHeader}>
          <h3 className={runnerStyles.modalTitle}>Delete Runner?</h3>
          <button className={runnerStyles.modalClose} onClick={onClose} disabled={busy}>
            <X size={18} />
          </button>
        </div>
        <div className={runnerStyles.modalBody}>
          <p className={runnerStyles.deleteMsg}>
            Remove <strong>{runner.name}</strong> from Docked? Containers managed by this runner
            will not be affected.
          </p>
          <label className={runnerStyles.uninstallCheck}>
            <input
              type="checkbox"
              checked={uninstall}
              onChange={(e) => setUninstall(e.target.checked)}
              disabled={busy}
            />
            <span>
              Uninstall dockhand from host
              <span className={runnerStyles.uninstallCheckSub}>
                Stops the service and removes all dockhand files from the remote machine
              </span>
            </span>
          </label>
          {error && (
            <p className={runnerStyles.formError} style={{ marginTop: 10 }}>
              {error}
            </p>
          )}
        </div>
        <div className={runnerStyles.modalFooter}>
          <button className={runnerStyles.actionBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className={`${runnerStyles.actionBtn} ${runnerStyles.actionBtnDanger}`}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? <Loader size={13} className={runnerStyles.spinIcon} /> : <Trash2 size={13} />}
            {busy
              ? uninstall
                ? "Uninstalling..."
                : "Deleting..."
              : uninstall
                ? "Uninstall & Delete"
                : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Type Picker ──────────────────────────────────────────────────────── */

function TypePickerDialog({ onClose, onSelectPortainer, onSelectRunner }) {
  return (
    <div className={styles.typePickerOverlay} onClick={onClose}>
      <div className={styles.typePickerModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.typePickerHeader}>
          <h3 className={styles.typePickerTitle}>Add Source</h3>
          <button className={styles.typePickerClose} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className={styles.typePickerBody}>
          <div
            className={styles.typePickerOption}
            onClick={onSelectPortainer}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onSelectPortainer()}
          >
            <PortainerIcon size={28} className={styles.typePickerOptionIcon} />
            <div className={styles.typePickerOptionText}>
              <span className={styles.typePickerOptionTitle}>Portainer Instance</span>
              <span className={styles.typePickerOptionDesc}>
                Connect to an existing Portainer installation to manage its containers.
              </span>
            </div>
          </div>
          <div
            className={styles.typePickerOption}
            onClick={onSelectRunner}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onSelectRunner()}
          >
            <Server size={28} className={styles.typePickerOptionIcon} />
            <div className={styles.typePickerOptionText}>
              <span className={styles.typePickerOptionTitle}>Dockhand Runner</span>
              <span className={styles.typePickerOptionDesc}>
                Install a lightweight agent on a machine to manage Docker containers and run
                operations.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main SourcesTab Component ────────────────────────────────────────── */

const SourcesTab = React.memo(function SourcesTab({
  // Portainer props (passed from SettingsTabs via useSettings)
  portainerInstances,
  onEditInstance,
  handleEditInstance,
  handleDeleteInstance,
  onClearPortainerData,
  clearingPortainerData,
  containers = [],
  portainerInstancesProp = [],
}) {
  // Runner state (self-contained via hook)
  const runner = useRunnerState();

  // Portainer local state
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, instanceId: null });
  const [portainerConfirm, setPortainerConfirm] = useState(false);
  const [detailInstance, setDetailInstance] = useState(null);

  // Portainer health state (mirrors runner healthStatus pattern)
  const [portainerHealth, setPortainerHealth] = useState({}); // id -> { online, checking }
  const hasAutoPingedPortainer = useRef(false);

  // Auto-ping all Portainer instances on mount
  useEffect(() => {
    if (hasAutoPingedPortainer.current || !portainerInstances?.length) return;
    hasAutoPingedPortainer.current = true;

    portainerInstances.forEach((inst) => {
      setPortainerHealth((prev) => ({ ...prev, [inst.id]: { checking: true } }));
      axios
        .post(`${API_BASE_URL}/api/portainer/instances/${inst.id}/health`)
        .then(({ data }) => {
          setPortainerHealth((prev) => ({
            ...prev,
            [inst.id]: { online: data.online, checking: false },
          }));
        })
        .catch(() => {
          setPortainerHealth((prev) => ({
            ...prev,
            [inst.id]: { online: false, checking: false },
          }));
        });
    });
  }, [portainerInstances]);

  // Type picker state
  const [showTypePicker, setShowTypePicker] = useState(false);

  /* ── Portainer handlers ───────────────────────────────────────────── */

  const handleDeleteClick = useCallback((instanceId) => {
    setDeleteConfirm({ isOpen: true, instanceId });
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteConfirm.instanceId) {
      handleDeleteInstance(deleteConfirm.instanceId);
    }
    setDeleteConfirm({ isOpen: false, instanceId: null });
  }, [deleteConfirm.instanceId, handleDeleteInstance]);

  const handleClearPortainerData = useCallback(async () => {
    if (!onClearPortainerData) {
      alert("Error: Clear Portainer Data handler is not available. Please refresh the page.");
      return;
    }
    try {
      await onClearPortainerData(true);
      setPortainerConfirm(false);
    } catch (error) {
      console.error("Error clearing Portainer data:", error);
      alert("Error clearing Portainer data: " + (error.message || "Unknown error"));
    }
  }, [onClearPortainerData]);

  const handleDeleteClose = useCallback(() => {
    setDeleteConfirm({ isOpen: false, instanceId: null });
  }, []);

  const handlePortainerConfirmClose = useCallback(() => {
    setPortainerConfirm(false);
  }, []);

  const handleEditInstanceClick = useCallback(
    (instance) => {
      if (onEditInstance) {
        onEditInstance(instance);
      } else {
        handleEditInstance(instance);
      }
    },
    [onEditInstance, handleEditInstance]
  );

  /* ── Type picker handlers ─────────────────────────────────────────── */

  const handleAddSource = useCallback(() => {
    setShowTypePicker(true);
  }, []);

  const handleSelectPortainer = useCallback(() => {
    setShowTypePicker(false);
    if (onEditInstance) {
      onEditInstance(null);
    }
  }, [onEditInstance]);

  const handleSelectRunner = useCallback(() => {
    setShowTypePicker(false);
    runner.setShowEnrollment(true);
  }, [runner]);

  /* ── Loading state ────────────────────────────────────────────────── */

  const hasPortainerInstances = portainerInstances && portainerInstances.length > 0;

  if (runner.loading) {
    return (
      <div className={styles.wrapper}>
        {/* Skeleton title + description */}
        <div className={`${styles.skeletonShimmer} ${styles.skeletonTitle}`} />
        <div className={`${styles.skeletonShimmer} ${styles.skeletonDesc}`} />

        {/* Skeleton section header */}
        <div className={`${styles.skeletonShimmer} ${styles.skeletonSectionTitle}`} />

        {/* Skeleton cards grid */}
        <div className={styles.skeletonGrid}>
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.skeletonCard}>
              <div className={styles.skeletonCardHeader}>
                <div className={`${styles.skeletonShimmer} ${styles.skeletonCardLogo}`} />
                <div className={styles.skeletonCardMeta}>
                  <div className={`${styles.skeletonShimmer} ${styles.skeletonCardName}`} />
                  <div className={`${styles.skeletonShimmer} ${styles.skeletonCardUrl}`} />
                </div>
                <div className={`${styles.skeletonShimmer} ${styles.skeletonCardStatus}`} />
              </div>
              <div className={styles.skeletonBadges}>
                <div className={`${styles.skeletonShimmer} ${styles.skeletonBadge}`} />
                <div className={`${styles.skeletonShimmer} ${styles.skeletonBadge}`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <h3 className={styles.title}>Connected Sources</h3>
      <p className={styles.description}>
        Manage your container sources. <strong>Portainer instances</strong> connect to existing
        Portainer installations. <strong>Runners</strong> are lightweight agents (
        <code>dockhand</code>) installed directly on your machines.
      </p>

      {/* ── Mixed source card grid ──────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>Sources</h4>
        </div>
        <div className={styles.sourceGrid}>
          {/* Portainer instance cards */}
          {portainerInstances.map((instance) => {
            const phs = portainerHealth[instance.id];
            return (
              <Card
                key={`portainer-${instance.id}`}
                variant="default"
                padding="sm"
                className={styles.sourceCard}
                onClick={() => setDetailInstance(instance)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setDetailInstance(instance)}
              >
                <div className={styles.runnerHeader}>
                  <div className={styles.portainerLogo}>
                    <PortainerIcon size={18} />
                  </div>
                  <div className={styles.runnerMeta}>
                    <strong className={styles.runnerName}>{instance.name}</strong>
                    <span className={styles.runnerUrl}>{instance.url}</span>
                  </div>
                  <div className={styles.statusColumn}>
                    {phs && !phs.checking && (
                      <span
                        className={phs.online ? styles.statusOnline : styles.statusOffline}
                        title={phs.online ? "Online" : "Offline"}
                      >
                        {phs.online ? <Wifi size={14} /> : <WifiOff size={14} />}
                        {phs.online ? "Online" : "Offline"}
                      </span>
                    )}
                    {phs?.checking && <span className={styles.statusChecking}>Checking...</span>}
                  </div>
                </div>

                <div className={styles.instanceBadges}>
                  <span className={`${styles.typeBadge} ${styles.typeBadgePortainer}`}>
                    Portainer
                  </span>
                  {instance.auth_type === "apikey" ? (
                    <span className={styles.authBadge}>
                      <Package size={11} className={styles.badgeIcon} />
                      API Key
                    </span>
                  ) : (
                    <span className={styles.authBadge}>
                      <Lock size={11} className={styles.badgeIcon} />
                      Password
                    </span>
                  )}
                </div>
              </Card>
            );
          })}

          {/* Runner cards */}
          {runner.runners.map((r) => {
            const hs = runner.healthStatus[r.id];
            return (
              <Card
                key={`runner-${r.id}`}
                variant="default"
                padding="sm"
                className={styles.sourceCard}
                onClick={() => runner.setDetailRunner(r)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && runner.setDetailRunner(r)}
              >
                <div className={styles.runnerHeader}>
                  <div className={styles.runnerIcon}>
                    <Server size={18} />
                  </div>
                  <div className={styles.runnerMeta}>
                    <strong className={styles.runnerName}>{r.name}</strong>
                    <span className={styles.runnerUrl}>{r.url}</span>
                  </div>
                  <div className={styles.statusColumn}>
                    {hs && !hs.checking && (
                      <span
                        className={hs.online ? styles.statusOnline : styles.statusOffline}
                        title={hs.online ? "Online" : "Offline"}
                      >
                        {hs.online ? <Wifi size={14} /> : <WifiOff size={14} />}
                        {hs.online ? "Online" : "Offline"}
                      </span>
                    )}
                    {hs?.checking && <span className={styles.statusChecking}>Checking...</span>}
                    {(() => {
                      const liveVersion = hs?.health?.version;
                      const dbVersion = r.version;
                      const displayVersion = liveVersion || dbVersion;
                      if (!displayVersion) return null;
                      const cleanVersion = displayVersion.replace(/^v/, "");
                      return (
                        <a
                          href={`https://github.com/dockedapp/dockhand/releases/tag/v${cleanVersion}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.versionBadge}
                          title={`View dockhand v${cleanVersion} release`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          v{cleanVersion}
                        </a>
                      );
                    })()}
                  </div>
                </div>

                <div className={styles.instanceBadges}>
                  <span className={`${styles.typeBadge} ${styles.typeBadgeRunner}`}>Runner</span>
                </div>

                {hs?.online && hs?.health?.docker !== undefined && (
                  <div className={styles.healthInfo}>
                    <span className={styles.healthBadge}>
                      Docker: {hs.health.docker ? "connected" : "unavailable"}
                    </span>
                  </div>
                )}

                {r.version &&
                  r.latest_version &&
                  hasVersionUpdate(r.version, r.latest_version) &&
                  !runner.updatedRunners.has(r.id) && (
                    <div className={styles.updateBanner}>
                      <ArrowUpCircle size={13} />
                      Update available: v{r.version.replace(/^v/, "")} → v
                      {r.latest_version.replace(/^v/, "")}
                    </div>
                  )}
              </Card>
            );
          })}

          {/* Add source card */}
          <div
            className={styles.addCard}
            onClick={handleAddSource}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && handleAddSource()}
          >
            <Plus size={24} className={styles.addIcon} />
            <span className={styles.addText}>Add Source</span>
          </div>
        </div>
      </div>

      {/* ── Portainer-specific sections (only when instances exist) ── */}
      {hasPortainerInstances && (
        <>
          {/* Intents Section */}
          <div className={styles.intentsSection}>
            <Suspense fallback={<LoadingSpinner size="sm" message="Loading intents..." />}>
              <IntentsPage containers={containers} portainerInstances={portainerInstancesProp} />
            </Suspense>
          </div>

          {/* Upgrade Blocklist */}
          <div className={styles.disallowedSection}>
            <h4 className={styles.sectionTitle}>Upgrade Blocklist</h4>
            <p className={styles.sectionDescription}>
              Containers in the right panel cannot be upgraded by Docked. Defaults protect critical
              infrastructure (Portainer, Nginx Proxy Manager, Docked itself). Containers not managed
              through a Portainer instance are automatically blocked.
            </p>
            <ContainerBlocklist containers={containers} />
          </div>
        </>
      )}

      {/* ── Data Management ─────────────────────────────────────────── */}
      {hasPortainerInstances && (
        <div className={styles.dataManagement}>
          <h4 className={styles.sectionTitle}>Data Management</h4>
          <div className={styles.dataActions}>
            <div className={styles.dataActionItem}>
              <Button
                type="button"
                variant="danger"
                onClick={() => setPortainerConfirm(true)}
                disabled={clearingPortainerData}
                className={styles.dangerButton}
              >
                {clearingPortainerData ? "Clearing..." : "Clear Portainer Data"}
              </Button>
              <small className={styles.dataActionHelper}>
                Removes all cached container information from Portainer instances. This will clear
                container data, stacks, and unused images. Portainer instance configurations will be
                preserved.
              </small>
            </div>
          </div>
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────── */}

      {/* Type Picker */}
      {showTypePicker && (
        <TypePickerDialog
          onClose={() => setShowTypePicker(false)}
          onSelectPortainer={handleSelectPortainer}
          onSelectRunner={handleSelectRunner}
        />
      )}

      {/* Portainer: Instance Detail */}
      <InstanceDetailModal
        instance={detailInstance}
        isOpen={!!detailInstance}
        onClose={() => setDetailInstance(null)}
        onEdit={(inst) => {
          setDetailInstance(null);
          handleEditInstanceClick(inst);
        }}
        onDelete={(instanceId) => {
          handleDeleteClick(instanceId);
        }}
      />

      {/* Portainer: Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={handleDeleteClose}
        onConfirm={handleDeleteConfirm}
        title="Delete Portainer Instance?"
        message="Are you sure you want to delete this Portainer instance? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />

      {/* Portainer: Clear Data Confirmation */}
      <ConfirmDialog
        isOpen={portainerConfirm}
        onClose={handlePortainerConfirmClose}
        onConfirm={handleClearPortainerData}
        title="Clear Portainer Data?"
        message="This will remove all cached container information from Portainer instances. This action cannot be undone."
        confirmText="Clear Data"
        cancelText="Cancel"
        variant="danger"
      />

      {/* Runner: Edit modal */}
      {runner.editRunner && (
        <div
          className={runnerStyles.modalOverlay}
          onClick={() => !runner.saving && runner.setEditRunner(null)}
        >
          <div
            className={runnerStyles.modal}
            style={{ maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={runnerStyles.modalHeader}>
              <h3 className={runnerStyles.modalTitle}>Edit Runner</h3>
              <button
                className={runnerStyles.modalClose}
                onClick={() => runner.setEditRunner(null)}
                disabled={runner.saving}
              >
                <X size={18} />
              </button>
            </div>
            <div className={runnerStyles.modalBody}>
              <RunnerEditForm
                runner={runner.editRunner}
                onSave={runner.handleEdit}
                onCancel={() => runner.setEditRunner(null)}
                saving={runner.saving}
              />
            </div>
          </div>
        </div>
      )}

      {/* Runner: Enrollment modal */}
      {runner.showEnrollment && (
        <EnrollmentModal
          onClose={() => runner.setShowEnrollment(false)}
          onEnrolled={runner.handleEnrolled}
        />
      )}

      {/* Runner: Delete dialog */}
      {runner.deleteConfirm && (
        <DeleteRunnerDialog
          runner={runner.deleteConfirm}
          onClose={() => runner.setDeleteConfirm(null)}
          onDeleted={() => {
            runner.setDeleteConfirm(null);
            runner.fetchRunners();
          }}
        />
      )}

      {/* Runner: Operations modal */}
      {runner.showOpsRunner && (
        <OperationsModal
          runner={runner.showOpsRunner}
          onClose={() => runner.setShowOpsRunner(null)}
          onRun={(r, appName, operationName) => {
            runner.setShowOpsRunner(null);
            runner.setRunOp({ runner: r, appName, operationName });
          }}
        />
      )}

      {/* Runner: Detail modal */}
      <RunnerDetailModal
        runner={runner.detailRunner}
        isOpen={!!runner.detailRunner}
        onClose={() => runner.setDetailRunner(null)}
        onEdit={(r) => {
          runner.setDetailRunner(null);
          runner.setEditRunner(r);
        }}
        onDelete={(r) => {
          runner.setDetailRunner(null);
          runner.setDeleteConfirm(r);
        }}
        onUpdate={runner.handleUpdate}
        onOperations={(r) => {
          runner.setDetailRunner(null);
          runner.setShowOpsRunner(r);
        }}
        healthStatus={runner.healthStatus}
        updatingRunner={runner.updatingRunner}
        updatedRunners={runner.updatedRunners}
        onHealthUpdate={runner.handleHealthUpdate}
        onRefreshRunners={runner.fetchRunners}
      />

      {/* Runner: Run Operation modal */}
      <RunOperationModal
        isOpen={!!runner.runOp}
        runnerId={runner.runOp?.runner?.id}
        appName={runner.runOp?.appName}
        operationName={runner.runOp?.operationName}
        onClose={() => runner.setRunOp(null)}
      />
    </div>
  );
});

SourcesTab.propTypes = {
  portainerInstances: PropTypes.arrayOf(PropTypes.object).isRequired,
  onEditInstance: PropTypes.func,
  handleEditInstance: PropTypes.func.isRequired,
  handleDeleteInstance: PropTypes.func.isRequired,
  onClearPortainerData: PropTypes.func,
  clearingPortainerData: PropTypes.bool,
  containers: PropTypes.array,
  portainerInstancesProp: PropTypes.array,
};

export default SourcesTab;

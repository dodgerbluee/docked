/**
 * RunnerTab Component
 * Manages dockhand instances — lightweight agents that manage Docker
 * containers directly without requiring Portainer.
 *
 * New runners are added via an automated enrollment flow:
 * 1. Click "Add Runner" → generates a one-time enrollment token
 * 2. Copy the install command and paste it into the target machine
 * 3. dockhand installs, starts, and registers itself automatically
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import {
  Server,
  Plus,
  Trash2,
  Edit2,
  Wifi,
  WifiOff,
  Copy,
  Check,
  Terminal,
  Loader,
  X,
  Play,
  Clock,
  RotateCcw,
  ArrowUpCircle,
} from "lucide-react";
import { API_BASE_URL } from "../../constants/api";
import Card from "../ui/Card";
import Button from "../ui/Button";
import LoadingSpinner from "../ui/LoadingSpinner";
import RunOperationModal from "../ui/RunOperationModal";
import styles from "./RunnerTab.module.css";

/* ── Edit form (kept for editing existing runners) ────────────────────── */

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
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.formRow}>
        <label className={styles.label}>Name</label>
        <input
          className={styles.input}
          type="text"
          value={form.name}
          onChange={set("name")}
          autoFocus
        />
      </div>
      <div className={styles.formRow}>
        <label className={styles.label}>URL</label>
        <input
          className={styles.input}
          type="url"
          value={form.url}
          onChange={set("url")}
          placeholder="http://192.168.1.100:7777"
        />
      </div>
      {error && <p className={styles.formError}>{error}</p>}
      <div className={styles.formActions}>
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

/* ── Enrollment modal ─────────────────────────────────────────────────── */

function EnrollmentModal({ onClose, onEnrolled }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [enrollment, setEnrollment] = useState(null);
  const [copied, setCopied] = useState(false);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef(null);

  // Generate enrollment token on mount, then immediately start polling for its status
  useEffect(() => {
    let cancelled = false;

    async function generate() {
      try {
        const { data } = await axios.post(`${API_BASE_URL}/api/runners/enrollment`);
        if (cancelled) return;

        if (data.success) {
          setEnrollment(data);
          setLoading(false);

          const enrollmentToken = data.token;
          setPolling(true);
          pollRef.current = setInterval(async () => {
            try {
              const { data: statusData } = await axios.get(
                `${API_BASE_URL}/api/runners/enrollment-status`,
                { params: { token: enrollmentToken } }
              );
              if (statusData.success && statusData.status === "registered" && statusData.runner) {
                clearInterval(pollRef.current);
                onEnrolled(statusData.runner);
              }
            } catch {
              // ignore transient poll errors
            }
          }, 3000);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || err.message);
          setLoading(false);
        }
      }
    }

    generate();
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [onEnrolled]);

  const handleCopy = useCallback(
    (text) => {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
    []
  );

  if (loading) {
    return (
      <div className={styles.modalOverlay}>
        <div className={styles.modal}>
          <div className={styles.modalHeader}>
            <h3 className={styles.modalTitle}>Add Runner</h3>
            <button className={styles.modalClose} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <div className={styles.modalBody}>
            <LoadingSpinner size="sm" message="Generating install command..." />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.modalOverlay}>
        <div className={styles.modal}>
          <div className={styles.modalHeader}>
            <h3 className={styles.modalTitle}>Add Runner</h3>
            <button className={styles.modalClose} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <div className={styles.modalBody}>
            <p className={styles.formError}>Failed to generate enrollment: {error}</p>
          </div>
          <div className={styles.modalFooter}>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const linuxCmd = enrollment?.installCommands?.linux;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Add Runner</h3>
          <button className={styles.modalClose} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.enrollTab}>
            <div className={styles.enrollTabIcon}>
              <Terminal size={16} />
            </div>
            <span className={styles.enrollTabLabel}>Linux Machine</span>
          </div>

          <p className={styles.enrollInstructions}>
            Run this command on the target machine to install and register the runner automatically:
          </p>

          <div className={styles.codeBlock}>
            <code className={styles.codeText}>{linuxCmd}</code>
            <button
              className={styles.copyBtn}
              onClick={() => handleCopy(linuxCmd)}
              title="Copy to clipboard"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>

          <div className={styles.enrollMeta}>
            <span className={styles.enrollMetaItem}>dockhand v{enrollment.dockhandVersion}</span>
            <span className={styles.enrollMetaDivider} />
            <span className={styles.enrollMetaItem}>Token expires in 10 minutes</span>
          </div>

          {polling && (
            <div className={styles.pollingStatus}>
              <Loader size={14} className={styles.spinIcon} />
              <span>Waiting for runner to register...</span>
            </div>
          )}
        </div>
        <div className={styles.modalFooter}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Operations Modal ─────────────────────────────────────────────────── */

function formatAge(ts) {
  if (!ts) return null;
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function OperationsModal({ runner, onClose, onRun }) {
  const [operations, setOperations] = useState([]);
  const [history, setHistory] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get(`${API_BASE_URL}/api/runners/${runner.id}/operations`);
      const ops = data.operations || [];
      setOperations(ops);
      await Promise.all(
        ops.map(async (op) => {
          try {
            const { data: hData } = await axios.get(
              `${API_BASE_URL}/api/runners/${runner.id}/operations/${encodeURIComponent(op.name)}/history?limit=1`
            );
            const last = (hData.history || [])[0] || null;
            setHistory((prev) => ({ ...prev, [op.name]: last }));
          } catch {
            // ignore per-op history errors
          }
        })
      );
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [runner.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.opsModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.opsModalTitle}>
            <Terminal size={16} />
            <h3 className={styles.modalTitle}>Operations</h3>
            <span className={styles.opsModalRunner}>{runner.name}</span>
          </div>
          <div className={styles.opsModalHeaderActions}>
            <button
              className={styles.opsRefreshBtn}
              onClick={() => fetchData(true)}
              disabled={refreshing || loading}
              title="Refresh"
            >
              <RotateCcw size={14} className={refreshing ? styles.spinIcon : undefined} />
            </button>
            <button className={styles.modalClose} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className={styles.opsModalMeta}>
          <span>{runner.url}</span>
        </div>

        <div className={styles.opsModalBody}>
          {loading && <LoadingSpinner size="sm" message="Loading operations…" />}
          {error && <p className={styles.formError}>{error}</p>}
          {!loading && !error && operations.length === 0 && (
            <p className={styles.opsEmpty}>No operations configured on this runner.</p>
          )}
          {!loading && operations.map((op) => {
            const last = history[op.name];
            return (
              <div key={op.name} className={styles.opsModalRow}>
                <div className={styles.opsModalOpInfo}>
                  <span className={styles.opsModalOpName}>{op.name}</span>
                  {op.description && (
                    <span className={styles.opsModalOpDesc}>{op.description}</span>
                  )}
                  {last && (
                    <span
                      className={`${styles.opsModalLastRun} ${last.exit_code === 0 ? styles.opLastRunOk : styles.opLastRunFail}`}
                      title={`Exit code: ${last.exit_code}`}
                    >
                      <Clock size={11} />
                      {formatAge(last.started_at)} · exit {last.exit_code}
                    </span>
                  )}
                </div>
                <button
                  className={styles.opRunBtn}
                  onClick={() => onRun(runner, op.name)}
                  title={`Run ${op.name}`}
                >
                  <Play size={12} />
                  Run
                </button>
              </div>
            );
          })}
        </div>

        <div className={styles.modalFooter}>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

/* ── Delete Runner Dialog ─────────────────────────────────────────────── */

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
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Delete Runner?</h3>
          <button className={styles.modalClose} onClick={onClose} disabled={busy}>
            <X size={18} />
          </button>
        </div>
        <div className={styles.modalBody}>
          <p className={styles.deleteMsg}>
            Remove <strong>{runner.name}</strong> from Docked? Containers managed by this runner
            will not be affected.
          </p>
          <label className={styles.uninstallCheck}>
            <input
              type="checkbox"
              checked={uninstall}
              onChange={(e) => setUninstall(e.target.checked)}
              disabled={busy}
            />
            <span>
              Uninstall dockhand from host
              <span className={styles.uninstallCheckSub}>
                Stops the service and removes all dockhand files from the remote machine
              </span>
            </span>
          </label>
          {error && <p className={styles.formError} style={{ marginTop: 10 }}>{error}</p>}
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.actionBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? <Loader size={13} className={styles.spinIcon} /> : <Trash2 size={13} />}
            {busy ? (uninstall ? "Uninstalling..." : "Deleting...") : uninstall ? "Uninstall & Delete" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main RunnerTab ───────────────────────────────────────────────────── */

export default function RunnerTab() {
  const [runners, setRunners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editRunner, setEditRunner] = useState(null);
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [healthStatus, setHealthStatus] = useState({}); // id → { online, checking, health }
  const [updatingRunner, setUpdatingRunner] = useState(null); // runnerId
  const [runOp, setRunOp] = useState(null); // { runner, operationName }
  const [showOpsRunner, setShowOpsRunner] = useState(null); // runner to show ops modal for

  const fetchRunners = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_BASE_URL}/api/runners`);
      if (data.success) setRunners(data.runners);
    } catch (err) {
      console.error("Failed to fetch runners:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRunners();
  }, [fetchRunners]);

  const handleEdit = useCallback(
    async ({ name, url, enabled }) => {
      if (!editRunner) return;
      setSaving(true);
      try {
        await axios.put(`${API_BASE_URL}/api/runners/${editRunner.id}`, {
          name,
          url,
          enabled,
        });
        await fetchRunners();
        setEditRunner(null);
      } catch (err) {
        console.error("Failed to update runner:", err);
      } finally {
        setSaving(false);
      }
    },
    [editRunner, fetchRunners]
  );

  const handleUpdate = useCallback(async (runner) => {
    setUpdatingRunner(runner.id);
    try {
      await axios.post(`${API_BASE_URL}/api/runners/${runner.id}/update`);
      setTimeout(() => {
        fetchRunners();
        setUpdatingRunner(null);
      }, 8000);
    } catch (err) {
      console.error("Failed to update runner:", err);
      setUpdatingRunner(null);
    }
  }, [fetchRunners]);

  const handlePing = useCallback(async (runner) => {
    setHealthStatus((prev) => ({ ...prev, [runner.id]: { checking: true } }));
    try {
      const { data } = await axios.post(`${API_BASE_URL}/api/runners/${runner.id}/health`);
      setHealthStatus((prev) => ({
        ...prev,
        [runner.id]: { online: data.online, checking: false, health: data.health },
      }));
    } catch {
      setHealthStatus((prev) => ({
        ...prev,
        [runner.id]: { online: false, checking: false },
      }));
    }
  }, []);

  const handleEnrolled = useCallback(
    (newRunner) => {
      setShowEnrollment(false);
      fetchRunners();
      // Auto-ping the new runner
      setTimeout(() => handlePing(newRunner), 1000);
    },
    [fetchRunners, handlePing]
  );

  const handleRunOp = useCallback((runner, operationName) => {
    setRunOp({ runner, operationName });
  }, []);

  if (loading) {
    return <LoadingSpinner size="md" message="Loading runners..." />;
  }

  return (
    <div className={styles.wrapper}>
      <h3 className={styles.title}>Manage Runners</h3>
      <p className={styles.description}>
        Runners are lightweight agents (<code>dockhand</code>) installed on your machines. They
        allow Docked to manage Docker containers and run operations remotely.
      </p>

      {/* Runner cards grid */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>Configured Runners</h4>
        </div>
        <div className={styles.runnerGrid}>
          {runners.map((runner) => {
            const hs = healthStatus[runner.id];
            return (
              <Card key={runner.id} variant="default" padding="sm" className={styles.runnerCard}>
                <div className={styles.runnerHeader}>
                  <div className={styles.runnerIcon}>
                    <Server size={18} />
                  </div>
                  <div className={styles.runnerMeta}>
                    <strong className={styles.runnerName}>{runner.name}</strong>
                    <span className={styles.runnerUrl}>{runner.url}</span>
                  </div>
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
                </div>

                {hs?.online && hs?.health && (
                  <div className={styles.healthInfo}>
                    {hs.health.runner && (
                      <span className={styles.healthBadge}>{hs.health.runner}</span>
                    )}
                    {hs.health.version && (
                      <span className={styles.healthBadge}>{hs.health.version}</span>
                    )}
                    {hs.health.docker !== undefined && (
                      <span className={styles.healthBadge}>
                        Docker: {hs.health.docker ? "connected" : "unavailable"}
                      </span>
                    )}
                  </div>
                )}

                {runner.version && runner.latest_version &&
                  runner.latest_version.replace(/^v/, "") !== runner.version.replace(/^v/, "") && (
                  <div className={styles.updateBanner}>
                    <ArrowUpCircle size={13} />
                    Update available: v{runner.version.replace(/^v/, "")} → v{runner.latest_version.replace(/^v/, "")}
                    <button
                      className={styles.updateBannerBtn}
                      onClick={() => handleUpdate(runner)}
                      disabled={updatingRunner === runner.id}
                    >
                      {updatingRunner === runner.id
                        ? <><Loader size={11} className={styles.spinIcon} /> Updating...</>
                        : "Update"}
                    </button>
                  </div>
                )}

                <div className={styles.runnerActions}>
                  <button
                    className={styles.actionBtn}
                    onClick={() => handlePing(runner)}
                    disabled={hs?.checking}
                    title="Test connection"
                  >
                    <Wifi size={14} />
                    Ping
                  </button>
                  <button
                    className={styles.actionBtn}
                    onClick={() => setEditRunner(runner)}
                    title="Edit runner"
                  >
                    <Edit2 size={14} />
                    Edit
                  </button>
                  <button
                    className={styles.actionBtn}
                    onClick={() => setShowOpsRunner(runner)}
                    title="View operations"
                  >
                    <Terminal size={14} />
                    Operations
                  </button>
                  <button
                    className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                    onClick={() => setDeleteConfirm(runner)}
                    title="Delete runner"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </Card>
            );
          })}

          {/* Add runner card */}
          <div
            className={styles.addCard}
            onClick={() => setShowEnrollment(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setShowEnrollment(true)}
          >
            <Plus size={24} className={styles.addIcon} />
            <span className={styles.addText}>Add Runner</span>
          </div>
        </div>
      </div>

      {/* Edit modal */}
      {editRunner && (
        <div className={styles.modalOverlay} onClick={() => !saving && setEditRunner(null)}>
          <div className={styles.modal} style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Edit Runner</h3>
              <button className={styles.modalClose} onClick={() => setEditRunner(null)} disabled={saving}>
                <X size={18} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <RunnerEditForm
                runner={editRunner}
                onSave={handleEdit}
                onCancel={() => setEditRunner(null)}
                saving={saving}
              />
            </div>
          </div>
        </div>
      )}

      {/* Enrollment modal */}
      {showEnrollment && (
        <EnrollmentModal onClose={() => setShowEnrollment(false)} onEnrolled={handleEnrolled} />
      )}

      {deleteConfirm && (
        <DeleteRunnerDialog
          runner={deleteConfirm}
          onClose={() => setDeleteConfirm(null)}
          onDeleted={() => { setDeleteConfirm(null); fetchRunners(); }}
        />
      )}

      {showOpsRunner && (
        <OperationsModal
          runner={showOpsRunner}
          onClose={() => setShowOpsRunner(null)}
          onRun={(runner, operationName) => {
            setShowOpsRunner(null);
            setRunOp({ runner, operationName });
          }}
        />
      )}

      <RunOperationModal
        isOpen={!!runOp}
        runnerId={runOp?.runner?.id}
        operationName={runOp?.operationName}
        onClose={() => setRunOp(null)}
      />
    </div>
  );
}

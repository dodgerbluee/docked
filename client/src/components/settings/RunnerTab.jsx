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
  Trash2,
  Wifi,
  WifiOff,
  Copy,
  Check,
  Terminal,
  Container,
  FileText,
  Loader,
  X,
  Play,
  Clock,
  RotateCcw,
  ArrowUpCircle,
} from "lucide-react";
import { API_BASE_URL } from "../../constants/api";
import { hasVersionUpdate } from "../../utils/versionHelpers";
import Card from "../ui/Card";
import Button from "../ui/Button";
import LoadingSpinner from "../ui/LoadingSpinner";
import RunOperationModal from "../ui/RunOperationModal";
import RunnerDetailModal from "./RunnerDetailModal";
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

export function EnrollmentModal({ onClose, onEnrolled }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [enrollment, setEnrollment] = useState(null);
  const [copied, setCopied] = useState(false);
  const [polling, setPolling] = useState(false);
  const [activeTab, setActiveTab] = useState("linux");
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

  const handleCopy = useCallback((text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

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
  const dockerCmd = enrollment?.installCommands?.docker;
  const composeSnippet = enrollment?.installCommands?.compose;
  const activeCmd =
    activeTab === "docker" ? dockerCmd : activeTab === "compose" ? composeSnippet : linuxCmd;

  const instructions = {
    linux:
      "Run this command on the target machine to install and register the runner automatically:",
    docker: "Run this command on any machine with Docker to start dockhand as a container:",
    compose: "Add this to your docker-compose.yml, then run docker compose up -d:",
  };

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
          <div className={styles.enrollTabs}>
            <button
              className={`${styles.enrollTabBtn} ${activeTab === "linux" ? styles.enrollTabBtnActive : ""}`}
              onClick={() => setActiveTab("linux")}
            >
              <Terminal size={14} />
              <span>Linux</span>
            </button>
            <button
              className={`${styles.enrollTabBtn} ${activeTab === "docker" ? styles.enrollTabBtnActive : ""}`}
              onClick={() => setActiveTab("docker")}
            >
              <Container size={14} />
              <span>Docker</span>
            </button>
            <button
              className={`${styles.enrollTabBtn} ${activeTab === "compose" ? styles.enrollTabBtnActive : ""}`}
              onClick={() => setActiveTab("compose")}
            >
              <FileText size={14} />
              <span>Compose</span>
            </button>
          </div>

          <p className={styles.enrollInstructions}>{instructions[activeTab]}</p>

          <div className={styles.codeBlock}>
            <code
              className={`${styles.codeText} ${activeTab === "compose" ? styles.codeTextMultiline : ""}`}
            >
              {activeCmd}
            </code>
            <button
              className={styles.copyBtn}
              onClick={() => handleCopy(activeCmd)}
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
          {!loading && !error && totalOps === 0 && (
            <p className={styles.opsEmpty}>No operations configured on this runner.</p>
          )}
          {!loading &&
            apps.map((app) => (
              <React.Fragment key={app.name}>
                {multiApp && <div className={styles.opsAppGroup}>{app.name}</div>}
                {(app.operations || []).map((op) => {
                  const last = op.lastRun;
                  return (
                    <div key={`${app.name}:${op.name}`} className={styles.opsModalRow}>
                      <div className={styles.opsModalOpInfo}>
                        <span className={styles.opsModalOpName}>{op.label || op.name}</span>
                        {app.description && !multiApp && (
                          <span className={styles.opsModalOpDesc}>{app.description}</span>
                        )}
                        {last && (
                          <span
                            className={`${styles.opsModalLastRun} ${last.exitCode === 0 ? styles.opLastRunOk : styles.opLastRunFail}`}
                            title={`Exit code: ${last.exitCode}`}
                          >
                            <Clock size={11} />
                            {formatAge(last.startedAt)} · exit {last.exitCode}
                          </span>
                        )}
                      </div>
                      <button
                        className={styles.opRunBtn}
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

        <div className={styles.modalFooter}>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
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
          {error && (
            <p className={styles.formError} style={{ marginTop: 10 }}>
              {error}
            </p>
          )}
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
  const [updatedRunners, setUpdatedRunners] = useState(new Set()); // ids that finished updating
  const updatePollRef = useRef({}); // runnerId → intervalId
  const [runOp, setRunOp] = useState(null); // { runner, operationName }
  const [showOpsRunner, setShowOpsRunner] = useState(null); // runner to show ops modal for
  const [detailRunner, setDetailRunner] = useState(null); // runner for detail modal

  const fetchRunners = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_BASE_URL}/api/runners`);
      if (data.success) setRunners(data.runners);
      return data.runners || [];
    } catch (err) {
      console.error("Failed to fetch runners:", err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-ping all runners on mount
  const hasAutoPinged = useRef(false);
  useEffect(() => {
    if (hasAutoPinged.current) return;
    hasAutoPinged.current = true;
    fetchRunners().then((list) => {
      if (!list?.length) return;
      list.forEach((r) => {
        setHealthStatus((prev) => ({ ...prev, [r.id]: { checking: true } }));
        axios
          .post(`${API_BASE_URL}/api/runners/${r.id}/health`)
          .then(({ data }) => {
            setHealthStatus((prev) => ({
              ...prev,
              [r.id]: { online: data.online, checking: false, health: data.health },
            }));
          })
          .catch(() => {
            setHealthStatus((prev) => ({
              ...prev,
              [r.id]: { online: false, checking: false },
            }));
          });
      });
    });
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

  const handleUpdate = useCallback(
    async (runner) => {
      setUpdatingRunner(runner.id);
      try {
        await axios.post(`${API_BASE_URL}/api/runners/${runner.id}/update`);
        const targetVersion = (runner.latest_version || "").replace(/^v/, "");
        let attempts = 0;
        updatePollRef.current[runner.id] = setInterval(async () => {
          attempts++;
          try {
            const { data } = await axios.post(`${API_BASE_URL}/api/runners/${runner.id}/health`);
            const liveVersion = (data.health?.version || "").replace(/^v/, "");
            if (liveVersion === targetVersion) {
              clearInterval(updatePollRef.current[runner.id]);
              delete updatePollRef.current[runner.id];
              setUpdatingRunner(null);
              setUpdatedRunners((prev) => new Set([...prev, runner.id]));
              fetchRunners();
              return;
            }
          } catch {
            /* runner still restarting, keep polling */
          }
          if (attempts >= 24) {
            // 2 min max
            clearInterval(updatePollRef.current[runner.id]);
            delete updatePollRef.current[runner.id];
            setUpdatingRunner(null);
            fetchRunners();
          }
        }, 5000);
      } catch (err) {
        console.error("Failed to update runner:", err);
        setUpdatingRunner(null);
      }
    },
    [fetchRunners]
  );

  // Clean up any active update polls on unmount
  useEffect(() => {
    const polls = updatePollRef.current;
    return () => {
      Object.values(polls).forEach(clearInterval);
    };
  }, []);

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

  const handleHealthUpdate = useCallback((runnerId, status) => {
    setHealthStatus((prev) => ({ ...prev, [runnerId]: status }));
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
              <Card
                key={runner.id}
                variant="default"
                padding="sm"
                className={styles.runnerCard}
                onClick={() => setDetailRunner(runner)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setDetailRunner(runner)}
              >
                <div className={styles.runnerHeader}>
                  <div className={styles.runnerIcon}>
                    <Server size={18} />
                  </div>
                  <div className={styles.runnerMeta}>
                    <strong className={styles.runnerName}>{runner.name}</strong>
                    <span className={styles.runnerUrl}>{runner.url}</span>
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
                      const dbVersion = runner.version;
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

                {hs?.online && hs?.health?.docker !== undefined && (
                  <div className={styles.healthInfo}>
                    <span className={styles.healthBadge}>
                      Docker: {hs.health.docker ? "connected" : "unavailable"}
                    </span>
                  </div>
                )}

                {runner.version &&
                  runner.latest_version &&
                  hasVersionUpdate(runner.version, runner.latest_version) &&
                  !updatedRunners.has(runner.id) && (
                    <div className={styles.updateBanner}>
                      <ArrowUpCircle size={13} />
                      Update available: v{runner.version.replace(/^v/, "")} → v
                      {runner.latest_version.replace(/^v/, "")}
                    </div>
                  )}
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
            <Server size={24} className={styles.addIcon} />
            <span className={styles.addText}>Add Runner</span>
          </div>
        </div>
      </div>

      {/* Edit modal */}
      {editRunner && (
        <div className={styles.modalOverlay} onClick={() => !saving && setEditRunner(null)}>
          <div
            className={styles.modal}
            style={{ maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Edit Runner</h3>
              <button
                className={styles.modalClose}
                onClick={() => setEditRunner(null)}
                disabled={saving}
              >
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
          onDeleted={() => {
            setDeleteConfirm(null);
            fetchRunners();
          }}
        />
      )}

      {showOpsRunner && (
        <OperationsModal
          runner={showOpsRunner}
          onClose={() => setShowOpsRunner(null)}
          onRun={(runner, appName, operationName) => {
            setShowOpsRunner(null);
            setRunOp({ runner, appName, operationName });
          }}
        />
      )}

      <RunnerDetailModal
        runner={detailRunner}
        isOpen={!!detailRunner}
        onClose={() => setDetailRunner(null)}
        onEdit={(r) => {
          setDetailRunner(null);
          setEditRunner(r);
        }}
        onDelete={(r) => {
          setDetailRunner(null);
          setDeleteConfirm(r);
        }}
        onUpdate={handleUpdate}
        onOperations={(r) => {
          setDetailRunner(null);
          setShowOpsRunner(r);
        }}
        healthStatus={healthStatus}
        updatingRunner={updatingRunner}
        updatedRunners={updatedRunners}
        onHealthUpdate={handleHealthUpdate}
        onRefreshRunners={fetchRunners}
      />

      <RunOperationModal
        isOpen={!!runOp}
        runnerId={runOp?.runner?.id}
        appName={runOp?.appName}
        operationName={runOp?.operationName}
        onClose={() => setRunOp(null)}
      />
    </div>
  );
}

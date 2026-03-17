import React, { useState, useCallback, useEffect, useRef } from "react";
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
  Clock,
  Activity,
  ScrollText,
  FileText,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Info,
  ChevronDown,
} from "lucide-react";
import axios from "axios";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import { API_BASE_URL } from "../../constants/api";
import { hasVersionUpdate } from "../../utils/versionHelpers";
import styles from "./RunnerDetailModal.module.css";

const TABS = {
  DETAILS: "details",
  EVENTS: "events",
  LOGS: "logs",
};

/** Map event types to human-readable labels and icons */
const EVENT_META = {
  status_change: { label: "Status", icon: Activity, color: "var(--dodger-blue)" },
  docker_change: { label: "Docker", icon: AlertTriangle, color: "#f59e0b" },
  heartbeat: { label: "Heartbeat", icon: Activity, color: "var(--text-secondary)" },
  heartbeat_error: { label: "Heartbeat Error", icon: XCircle, color: "var(--text-error, #ef4444)" },
  health_check: { label: "Health Check", icon: CheckCircle, color: "#22c55e" },
  health_check_error: { label: "Health Check Failed", icon: XCircle, color: "var(--text-error, #ef4444)" },
  fetch_error: { label: "Fetch Error", icon: AlertTriangle, color: "var(--text-error, #ef4444)" },
  url_change: { label: "URL Changed", icon: Info, color: "var(--dodger-blue)" },
  version_change: { label: "Version", icon: ArrowUpCircle, color: "#22c55e" },
  enrolled: { label: "Enrolled", icon: CheckCircle, color: "#22c55e" },
  re_enrolled: { label: "Re-enrolled", icon: RefreshCw, color: "var(--dodger-blue)" },
  updated: { label: "Updated", icon: ArrowUpCircle, color: "#22c55e" },
  info: { label: "Info", icon: Info, color: "var(--text-secondary)" },
};

function formatTimeAgo(dateStr) {
  if (!dateStr) return "Never";
  const date = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function formatTimestamp(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
  return date.toLocaleString();
}

/**
 * RunnerDetailModal Component
 * Shows runner details with tabs for Details, Events, and Logs.
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
  const [activeTab, setActiveTab] = useState(TABS.DETAILS);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsOffset, setEventsOffset] = useState(0);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState(null);
  const logsEndRef = useRef(null);

  // Reset state when modal opens/closes or runner changes
  useEffect(() => {
    if (isOpen && runner) {
      setActiveTab(TABS.DETAILS);
      setEvents([]);
      setEventsOffset(0);
      setEventsTotal(0);
      setLogs([]);
      setLogsError(null);
    }
  }, [isOpen, runner?.id]);

  // Fetch events when Events tab is selected
  useEffect(() => {
    if (activeTab === TABS.EVENTS && runner && events.length === 0 && !eventsLoading) {
      fetchEvents(0);
    }
  }, [activeTab, runner?.id]);

  // Fetch logs when Logs tab is selected
  useEffect(() => {
    if (activeTab === TABS.LOGS && runner && logs.length === 0 && !logsLoading) {
      fetchLogs();
    }
  }, [activeTab, runner?.id]);

  const fetchEvents = useCallback(
    async (offset = 0) => {
      if (!runner) return;
      setEventsLoading(true);
      try {
        const { data } = await axios.get(
          `${API_BASE_URL}/api/runners/${runner.id}/events?limit=50&offset=${offset}`
        );
        if (data.success) {
          setEvents((prev) => (offset === 0 ? data.events : [...prev, ...data.events]));
          setEventsTotal(data.total);
          setEventsOffset(offset + data.events.length);
        }
      } catch {
        // silently fail
      } finally {
        setEventsLoading(false);
      }
    },
    [runner]
  );

  const fetchLogs = useCallback(async () => {
    if (!runner) return;
    setLogsLoading(true);
    setLogsError(null);
    try {
      const { data } = await axios.get(
        `${API_BASE_URL}/api/runners/${runner.id}/logs?lines=200`
      );
      if (data.success) {
        setLogs(data.lines || []);
      } else {
        setLogsError(data.error || "Failed to fetch logs");
        setLogs([]);
      }
    } catch (err) {
      setLogsError(err.response?.data?.error || err.message);
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, [runner]);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logsEndRef.current && logs.length > 0) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

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

  const dockerStatusLabel =
    runner.docker_status === "ok"
      ? "Connected"
      : runner.docker_status === "unavailable"
        ? "Unavailable"
        : "Unknown";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={runner.name || "Runner Details"}
      size="md"
      fullScreenMobile
    >
      <div className={styles.modalBody}>
        {/* Tab bar */}
        <div className={styles.tabBar}>
          <button
            className={`${styles.tab} ${activeTab === TABS.DETAILS ? styles.tabActive : ""}`}
            onClick={() => setActiveTab(TABS.DETAILS)}
          >
            <Activity size={13} />
            Details
          </button>
          <button
            className={`${styles.tab} ${activeTab === TABS.EVENTS ? styles.tabActive : ""}`}
            onClick={() => setActiveTab(TABS.EVENTS)}
          >
            <ScrollText size={13} />
            Events
          </button>
          <button
            className={`${styles.tab} ${activeTab === TABS.LOGS ? styles.tabActive : ""}`}
            onClick={() => setActiveTab(TABS.LOGS)}
          >
            <FileText size={13} />
            Logs
          </button>
        </div>

        {/* ── Details Tab ── */}
        {activeTab === TABS.DETAILS && (
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

            {/* Docker status — always show from DB, not just live health */}
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Docker</span>
              <span className={styles.detailValue}>
                <span
                  className={`${styles.dockerBadge} ${
                    runner.docker_status === "ok"
                      ? styles.dockerConnected
                      : runner.docker_status === "unavailable"
                        ? styles.dockerUnavailable
                        : styles.dockerUnknown
                  }`}
                >
                  {dockerStatusLabel}
                </span>
                {runner.docker_status_since && (
                  <span className={styles.dockerSince}>
                    since {formatTimeAgo(runner.docker_status_since)}
                  </span>
                )}
              </span>
            </div>

            {/* Last seen */}
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Last Seen</span>
              <span className={styles.detailValue}>
                <span className={styles.lastSeen}>
                  <Clock size={12} />
                  {runner.last_seen ? (
                    <span title={formatTimestamp(runner.last_seen)}>
                      {formatTimeAgo(runner.last_seen)}
                    </span>
                  ) : (
                    "Never"
                  )}
                </span>
              </span>
            </div>

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
        )}

        {/* ── Events Tab ── */}
        {activeTab === TABS.EVENTS && (
          <div className={styles.eventsSection}>
            {eventsLoading && events.length === 0 ? (
              <div className={styles.loadingState}>
                <Loader size={16} className={styles.spinIcon} />
                Loading events...
              </div>
            ) : events.length === 0 ? (
              <div className={styles.emptyState}>No events recorded yet.</div>
            ) : (
              <>
                <div className={styles.eventsList}>
                  {events.map((event) => {
                    const meta = EVENT_META[event.event_type] || EVENT_META.info;
                    const Icon = meta.icon;
                    return (
                      <div key={event.id} className={styles.eventItem}>
                        <div className={styles.eventIcon} style={{ color: meta.color }}>
                          <Icon size={14} />
                        </div>
                        <div className={styles.eventContent}>
                          <div className={styles.eventHeader}>
                            <span className={styles.eventType}>{meta.label}</span>
                            <span
                              className={styles.eventTime}
                              title={formatTimestamp(event.created_at)}
                            >
                              {formatTimeAgo(event.created_at)}
                            </span>
                          </div>
                          <div className={styles.eventMessage}>{event.message}</div>
                          {event.details && typeof event.details === "object" && (
                            <div className={styles.eventDetails}>
                              {Object.entries(event.details).map(([key, val]) => (
                                <span key={key} className={styles.eventDetailItem}>
                                  {key}: {String(val)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {events.length < eventsTotal && (
                  <button
                    className={styles.loadMoreBtn}
                    onClick={() => fetchEvents(eventsOffset)}
                    disabled={eventsLoading}
                  >
                    {eventsLoading ? (
                      <Loader size={13} className={styles.spinIcon} />
                    ) : (
                      <ChevronDown size={13} />
                    )}
                    Load more ({eventsTotal - events.length} remaining)
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Logs Tab ── */}
        {activeTab === TABS.LOGS && (
          <div className={styles.logsSection}>
            <div className={styles.logsToolbar}>
              <span className={styles.logsLabel}>Dockhand Service Logs</span>
              <button
                className={styles.logsRefreshBtn}
                onClick={fetchLogs}
                disabled={logsLoading}
              >
                {logsLoading ? (
                  <Loader size={12} className={styles.spinIcon} />
                ) : (
                  <RefreshCw size={12} />
                )}
              </button>
            </div>
            {logsLoading && logs.length === 0 ? (
              <div className={styles.loadingState}>
                <Loader size={16} className={styles.spinIcon} />
                Fetching logs...
              </div>
            ) : logsError ? (
              <div className={styles.logsError}>
                <AlertTriangle size={14} />
                {logsError}
              </div>
            ) : logs.length === 0 ? (
              <div className={styles.emptyState}>No logs available.</div>
            ) : (
              <div className={styles.logsContainer}>
                {logs.map((line, i) => (
                  <div key={i} className={styles.logLine}>
                    {line}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
        )}

        {/* Footer */}
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

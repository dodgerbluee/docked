import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { RefreshCw, ChevronRight, ChevronDown } from "lucide-react";
import axios from "axios";
import { API_BASE_URL } from "../../utils/api";
import Button from "../ui/Button";
import Card from "../ui/Card";
import Alert from "../ui/Alert";
import { CardSkeleton } from "../ui/LoadingSkeleton";
import styles from "./LogsTab.module.css";

const DEFAULT_TAIL_LINES = 500;
const MAX_TAIL_LINES = 5000;

/** Log levels for filter buttons; order and labels for display */
const LOG_LEVELS = [
  { key: "info", label: "INFO" },
  { key: "warn", label: "WARN" },
  { key: "error", label: "ERROR" },
  { key: "debug", label: "DEBUG" },
];

function normalizeLevel(level) {
  if (!level || typeof level !== "string") return "other";
  const lower = level.toLowerCase();
  if (lower === "info") return "info";
  if (lower === "warn" || lower === "warning") return "warn";
  if (lower === "error" || lower === "err" || lower === "critical") return "error";
  if (lower === "debug") return "debug";
  return "other";
}

function getLevelFromLine(line) {
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === "object" && parsed.level) {
      return normalizeLevel(parsed.level);
    }
  } catch {
    // not JSON
  }
  const bracketMatch = line.match(/(\[)(info|warn|warning|error|err|debug)(\])/i);
  if (bracketMatch) {
    return normalizeLevel(bracketMatch[2]);
  }
  return "other";
}

/**
 * LogsTab Component
 * Displays application logs with color-coded log levels and level filter buttons.
 *
 * Uses byte-offset streaming so the log file is never fully read into memory —
 * safe for deployments that run for months with large log files.
 */
function LogsTab() {
  const [logLines, setLogLines] = useState([]); // array of raw log line strings
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState(new Set());
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [levelFilters, setLevelFilters] = useState(() => new Set());
  const [tailLines, setTailLines] = useState(DEFAULT_TAIL_LINES);
  const [tailLinesInput, setTailLinesInput] = useState(String(DEFAULT_TAIL_LINES));

  // Byte offset tracking — replaces line-count tracking
  const lastFileSizeRef = useRef(0);

  const contentRef = useRef(null);
  const wasAtBottomRef = useRef(true);

  const toggleLevelFilter = useCallback((key) => {
    setLevelFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const checkIfAtBottom = () => {
    if (!contentRef.current) return false;
    const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
    return scrollHeight - scrollTop - clientHeight < 50;
  };

  const scrollToBottom = () => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  };

  /**
   * Apply a rolling window: keep only the newest `max` lines.
   * Prevents unbounded memory growth when streaming long-running deployments.
   */
  const applyRollingWindow = useCallback(
    (lines, max) => (lines.length > max ? lines.slice(lines.length - max) : lines),
    []
  );

  const fetchLogs = useCallback(
    async (incremental = false) => {
      try {
        setError(null);
        if (!incremental) setLoading(true);

        wasAtBottomRef.current = checkIfAtBottom();

        const params = incremental ? { offset: lastFileSizeRef.current } : { lines: tailLines };

        const response = await axios.get(`${API_BASE_URL}/api/logs`, {
          params,
          headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        });

        if (!response.data.success) {
          setError(response.data.error || "Failed to fetch logs");
          return;
        }

        const { logs: rawLogs, fileSize, rotated } = response.data;

        // If the log file was rotated (fileSize shrank), do a fresh tail load
        if (rotated) {
          lastFileSizeRef.current = 0;
          fetchLogs(false);
          return;
        }

        lastFileSizeRef.current = fileSize ?? 0;

        if (rawLogs && rawLogs.trim().length > 0) {
          const incoming = rawLogs.split("\n").filter((l) => l.trim());

          if (incremental) {
            setLogLines((prev) => applyRollingWindow([...prev, ...incoming], tailLines));
          } else {
            setLogLines(applyRollingWindow(incoming, tailLines));
          }
        }

        setIsInitialLoad(false);

        if (wasAtBottomRef.current) {
          setTimeout(scrollToBottom, 0);
        }
      } catch (err) {
        console.error("Error fetching logs:", err);
        setError(err.response?.data?.error || err.message || "Failed to fetch logs");
      } finally {
        setLoading(false);
      }
    },
    [tailLines, applyRollingWindow]
  );

  // Initial load
  useEffect(() => {
    fetchLogs(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh interval (5 s, incremental byte-offset fetch)
  useEffect(() => {
    if (autoRefresh && !isInitialLoad) {
      const id = setInterval(() => fetchLogs(true), 5000);
      return () => clearInterval(id);
    }
  }, [autoRefresh, isInitialLoad, fetchLogs]);

  const handleRefresh = useCallback(() => {
    fetchLogs(logLines.length > 0);
  }, [fetchLogs, logLines.length]);

  // Re-tail when the user changes tailLines (full reload with new line count)
  const handleTailLinesChange = useCallback((e) => {
    setTailLinesInput(e.target.value);
  }, []);

  const handleTailLinesBlur = useCallback(() => {
    const parsed = parseInt(tailLinesInput, 10);
    if (!isNaN(parsed) && parsed > 0) {
      const clamped = Math.min(parsed, MAX_TAIL_LINES);
      setTailLinesInput(String(clamped));
      setTailLines(clamped);
      lastFileSizeRef.current = 0;
      setLogLines([]);
      setIsInitialLoad(true);
    } else {
      setTailLinesInput(String(tailLines));
    }
  }, [tailLinesInput, tailLines]);

  const handleTailLinesKeyDown = useCallback((e) => {
    if (e.key === "Enter") {
      e.target.blur();
    }
  }, []);

  const toggleLogExpansion = (logIndex) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(logIndex)) next.delete(logIndex);
      else next.add(logIndex);
      return next;
    });
  };

  // Re-fetch when tailLines changes (triggered via blur)
  useEffect(() => {
    if (!isInitialLoad) {
      fetchLogs(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tailLines]);

  const formattedLogs = useMemo(() => {
    if (!logLines.length) return null;

    const withLevel = logLines.map((line, index) => ({
      line,
      index,
      level: getLevelFromLine(line),
    }));
    const filtered =
      levelFilters.size === 0
        ? withLevel
        : withLevel.filter(({ level }) => level === "other" || levelFilters.has(level));

    return filtered.map(({ line, index }) => {
      let logEntry = null;
      try {
        logEntry = JSON.parse(line);
      } catch {
        // Not JSON, treat as plain text
      }

      if (logEntry && typeof logEntry === "object") {
        const {
          timestamp,
          level,
          message,
          module,
          service,
          requestId,
          userId,
          jobId,
          batchId,
          ...metadata
        } = logEntry;

        let levelClass = styles.logDefault;
        const levelLower = (level || "").toLowerCase();
        if (levelLower === "info") levelClass = styles.logInfo;
        else if (levelLower === "warn" || levelLower === "warning") levelClass = styles.logWarn;
        else if (levelLower === "error" || levelLower === "err" || levelLower === "critical")
          levelClass = styles.logError;
        else if (levelLower === "debug") levelClass = styles.logDebug;

        const contextParts = [];
        if (module) contextParts.push(`[${module}]`);
        if (service) contextParts.push(`[${service}]`);
        if (requestId) contextParts.push(`[req:${String(requestId).substring(0, 8)}]`);
        if (userId) contextParts.push(`[user:${userId}]`);
        if (jobId) contextParts.push(`[job:${jobId}]`);
        if (batchId) contextParts.push(`[batch:${batchId}]`);
        const contextStr = contextParts.length > 0 ? contextParts.join(" ") + " " : "";

        let shortTimestamp = "";
        if (timestamp) {
          try {
            const d = new Date(timestamp);
            shortTimestamp = d.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
          } catch {
            shortTimestamp = timestamp;
          }
        }

        const metaKeys = Object.keys(metadata).filter((key) => {
          const value = metadata[key];
          return (
            value !== null &&
            value !== undefined &&
            value !== "" &&
            ![
              "timestamp",
              "level",
              "message",
              "module",
              "service",
              "requestId",
              "userId",
              "jobId",
              "batchId",
              "stack",
            ].includes(key)
          );
        });

        const hasExpandableContent = metaKeys.length > 0 || metadata.stack;
        const isExpanded = expandedLogs.has(index);

        return (
          <div key={index} className={styles.logEntry}>
            <div
              className={`${styles.logLine} ${hasExpandableContent ? styles.logLineClickable : ""}`}
              onClick={hasExpandableContent ? () => toggleLogExpansion(index) : undefined}
              role={hasExpandableContent ? "button" : undefined}
              tabIndex={hasExpandableContent ? 0 : undefined}
              onKeyDown={
                hasExpandableContent
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleLogExpansion(index);
                      }
                    }
                  : undefined
              }
            >
              <span className={styles.logMeta}>
                <span className={styles.expandIcon}>
                  {hasExpandableContent ? (
                    isExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )
                  ) : (
                    <span style={{ width: "14px", display: "inline-block" }}></span>
                  )}
                </span>
                <span
                  className={styles.logTimestamp}
                  data-full={timestamp || ""}
                  data-short={shortTimestamp}
                >
                  {timestamp || ""}
                </span>
                <span className={styles.logDefault}> </span>
                <span className={styles.logBracket}>[</span>
                <span className={levelClass}>{level?.toUpperCase() || "UNKNOWN"}</span>
                <span className={styles.logBracket}>]</span>
              </span>
              {contextStr && <span className={styles.logContext}>{contextStr}</span>}
              <span className={styles.logMessage}>{message || ""}</span>
              {hasExpandableContent && (
                <span className={styles.expandHint}>
                  {isExpanded ? " (click to collapse)" : " (click to expand)"}
                </span>
              )}
            </div>
            {isExpanded && metaKeys.length > 0 && (
              <div className={styles.logMetadata}>
                <div className={styles.metadataHeader}>Metadata</div>
                <pre className={styles.logMetadataContent}>
                  {JSON.stringify(
                    Object.fromEntries(metaKeys.map((k) => [k, metadata[k]])),
                    null,
                    2
                  )}
                </pre>
              </div>
            )}
            {isExpanded && metadata.stack && (
              <div className={styles.logStack}>
                <div className={styles.stackHeader}>Stack Trace</div>
                <pre className={styles.logStackContent}>{metadata.stack}</pre>
              </div>
            )}
          </div>
        );
      }

      // Plain text log line
      const bracketMatch = line.match(/(\[)(info|warn|warning|error|err|debug)(\])/i);
      if (bracketMatch) {
        const matchIndex = bracketMatch.index;
        const beforeMatch = line.substring(0, matchIndex);
        const [, openBracket, levelText, closeBracket] = bracketMatch;
        const afterMatch = line.substring(matchIndex + bracketMatch[0].length);

        let levelClass = styles.logDefault;
        const lowerLevel = levelText.toLowerCase();
        if (lowerLevel === "info") levelClass = styles.logInfo;
        else if (lowerLevel === "warn" || lowerLevel === "warning") levelClass = styles.logWarn;
        else if (lowerLevel === "error" || lowerLevel === "err") levelClass = styles.logError;
        else if (lowerLevel === "debug") levelClass = styles.logDebug;

        return (
          <div key={index} className={styles.logEntry}>
            <div className={styles.logLine}>
              <span className={styles.expandIcon}>
                <span style={{ width: "14px", display: "inline-block" }}></span>
              </span>
              <span className={styles.logDefault}>{beforeMatch}</span>
              <span className={styles.logDefault}>{openBracket}</span>
              <span className={levelClass}>{levelText.toUpperCase()}</span>
              <span className={styles.logDefault}>{closeBracket}</span>
              <span className={styles.logDefault}>{afterMatch}</span>
            </div>
          </div>
        );
      }

      return (
        <div key={index} className={styles.logEntry}>
          <div className={styles.logLine}>
            <span className={styles.expandIcon}>
              <span style={{ width: "14px", display: "inline-block" }}></span>
            </span>
            <span className={styles.logDefault}>{line}</span>
          </div>
        </div>
      );
    });
  }, [logLines, expandedLogs, levelFilters]);

  if (loading) {
    return (
      <div className={styles.logsTab}>
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className={styles.logsTab}>
      <Card>
        <div className={styles.headerWrapper}>
          <div className={styles.header}>
            <div className={styles.headerTitle}>
              <h3 className={styles.title}>Application Logs</h3>
            </div>
            <div className={styles.levelFilters}>
              {LOG_LEVELS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={`${styles.levelFilterBtn} ${styles[`levelFilter_${key}`]} ${
                    levelFilters.has(key) ? styles.levelFilterActive : ""
                  }`}
                  onClick={() => toggleLevelFilter(key)}
                  aria-pressed={levelFilters.has(key)}
                  aria-label={`Filter by ${label}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className={styles.actions}>
              <div className={styles.tailLinesControl}>
                <label className={styles.tailLinesLabel} htmlFor="tail-lines-input">
                  Tail
                </label>
                <input
                  id="tail-lines-input"
                  type="number"
                  min="1"
                  max={MAX_TAIL_LINES}
                  value={tailLinesInput}
                  onChange={handleTailLinesChange}
                  onBlur={handleTailLinesBlur}
                  onKeyDown={handleTailLinesKeyDown}
                  className={styles.tailLinesInput}
                  aria-label="Number of log lines to tail"
                />
                <span className={styles.tailLinesLabel}>lines</span>
              </div>
              <Button
                variant={autoRefresh ? "primary" : "outline"}
                onClick={() => setAutoRefresh(!autoRefresh)}
                icon={RefreshCw}
                iconPosition="left"
                size="sm"
              >
                {autoRefresh ? "Auto Refresh On" : "Auto Refresh Off"}
              </Button>
              <Button
                variant="outline"
                onClick={handleRefresh}
                icon={RefreshCw}
                iconPosition="left"
                size="sm"
              >
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <Alert variant="error" className={styles.error}>
            {error}
          </Alert>
        )}

        <div
          ref={contentRef}
          className={styles.content}
          onScroll={() => {
            wasAtBottomRef.current = checkIfAtBottom();
          }}
        >
          {logLines.length > 0 ? (
            <div className={styles.logContent}>{formattedLogs}</div>
          ) : (
            <div className={styles.empty}>No logs available</div>
          )}
        </div>
      </Card>
    </div>
  );
}

LogsTab.propTypes = {};

export default LogsTab;

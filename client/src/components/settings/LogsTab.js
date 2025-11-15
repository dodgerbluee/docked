import React, { useState, useEffect, useMemo, useRef } from "react";
// PropTypes is not currently used but kept for potential future use
import { RefreshCw, ChevronRight, ChevronDown } from "lucide-react";
import axios from "axios";
import { API_BASE_URL } from "../../utils/api";
import Button from "../ui/Button";
import Card from "../ui/Card";
import Alert from "../ui/Alert";
import { CardSkeleton } from "../ui/LoadingSkeleton";
import styles from "./LogsTab.module.css";

/**
 * LogsTab Component
 * Displays application logs with color-coded log levels
 */
function LogsTab() {
  const [logs, setLogs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(null);
  const [expandedLogs, setExpandedLogs] = useState(new Set());
  const [lastLineCount, setLastLineCount] = useState(0);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const contentRef = useRef(null);
  const wasAtBottomRef = useRef(true);

  // Check if user is at bottom of scroll
  const checkIfAtBottom = () => {
    if (!contentRef.current) return false;
    const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
    return scrollHeight - scrollTop - clientHeight < 50; // 50px threshold
  };

  // Scroll to bottom
  const scrollToBottom = () => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  };

  const fetchLogs = async (incremental = false) => {
    try {
      setError(null);
      if (!incremental) {
        setLoading(true);
      }
      
      // Check if user is at bottom before fetching
      wasAtBottomRef.current = checkIfAtBottom();
      
      const params = incremental && lastLineCount > 0 
        ? { since: lastLineCount }
        : { lines: 500 };
      
      const response = await axios.get(`${API_BASE_URL}/api/logs`, {
        params,
        headers: {
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
      });
      
      if (response.data.success) {
        const newLogs = response.data.logs || "";
        const newLineCount = response.data.totalLines || 0;
        
        if (incremental && logs && newLogs) {
          // Append new lines to existing logs
          setLogs((prevLogs) => {
            const prevLines = prevLogs.split('\n').filter(line => line.trim());
            const newLines = newLogs.split('\n').filter(line => line.trim());
            // Only add lines that aren't already present (avoid duplicates)
            const existingLastLine = prevLines[prevLines.length - 1];
            const newLinesToAdd = newLines.filter((line, idx) => {
              // Skip first line if it matches the last line we have (could be a continuation)
              if (idx === 0 && existingLastLine && line === existingLastLine) {
                return false;
              }
              return true;
            });
            return prevLogs + (prevLogs && newLinesToAdd.length > 0 ? '\n' : '') + newLinesToAdd.join('\n');
          });
        } else {
          // Full refresh (initial load or manual refresh)
          setLogs(newLogs);
        }
        
        setLastLineCount(newLineCount);
        setIsInitialLoad(false);
        
        // Auto-scroll if user was at bottom
        if (wasAtBottomRef.current) {
          setTimeout(scrollToBottom, 0);
        }
      } else {
        setError(response.data.error || "Failed to fetch logs");
      }
    } catch (err) {
      console.error("Error fetching logs:", err);
      const errorMessage = err.response?.data?.error || err.message || "Failed to fetch logs";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoRefresh && !isInitialLoad) {
      const interval = setInterval(() => {
        fetchLogs(true); // Incremental fetch
      }, 5000); // Refresh every 5 seconds
      setRefreshInterval(interval);
      return () => clearInterval(interval);
    } else {
      if (refreshInterval) {
        clearInterval(refreshInterval);
        setRefreshInterval(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, isInitialLoad]);

  const toggleLogExpansion = (logIndex) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(logIndex)) {
        next.delete(logIndex);
      } else {
        next.add(logIndex);
      }
      return next;
    });
  };

  const formattedLogs = useMemo(() => {
    if (!logs) return null;

    // Split logs by lines
    const lines = logs.split('\n').filter(line => line.trim());
    
    return lines.map((line, index) => {
      // Try to parse as JSON (Winston structured logs)
      let logEntry = null;
      try {
        logEntry = JSON.parse(line);
      } catch (e) {
        // Not JSON, treat as plain text
      }

      if (logEntry && typeof logEntry === 'object') {
        // Format JSON log entry
        const { timestamp, level, message, module, service, requestId, userId, jobId, batchId, ...metadata } = logEntry;
        
        // Determine log level color
        let levelClass = styles.logDefault;
        const levelLower = (level || '').toLowerCase();
        if (levelLower === 'info') {
          levelClass = styles.logInfo;
        } else if (levelLower === 'warn' || levelLower === 'warning') {
          levelClass = styles.logWarn;
        } else if (levelLower === 'error' || levelLower === 'err' || levelLower === 'critical') {
          levelClass = styles.logError;
        } else if (levelLower === 'debug') {
          levelClass = styles.logDebug;
        }

        // Build context string
        const contextParts = [];
        if (module) contextParts.push(`[${module}]`);
        if (service) contextParts.push(`[${service}]`);
        if (requestId) contextParts.push(`[req:${String(requestId).substring(0, 8)}]`);
        if (userId) contextParts.push(`[user:${userId}]`);
        if (jobId) contextParts.push(`[job:${jobId}]`);
        if (batchId) contextParts.push(`[batch:${batchId}]`);
        const contextStr = contextParts.length > 0 ? contextParts.join(' ') + ' ' : '';

        // Filter out empty metadata
        const metaKeys = Object.keys(metadata).filter(key => {
          const value = metadata[key];
          return value !== null && value !== undefined && value !== '' && 
                 !['timestamp', 'level', 'message', 'module', 'service', 'requestId', 'userId', 'jobId', 'batchId', 'stack'].includes(key);
        });

        const hasExpandableContent = metaKeys.length > 0 || metadata.stack;
        const isExpanded = expandedLogs.has(index);

        return (
          <div key={index} className={styles.logEntry}>
            <div 
              className={`${styles.logLine} ${hasExpandableContent ? styles.logLineClickable : ''}`}
              onClick={hasExpandableContent ? () => toggleLogExpansion(index) : undefined}
              role={hasExpandableContent ? "button" : undefined}
              tabIndex={hasExpandableContent ? 0 : undefined}
              onKeyDown={hasExpandableContent ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleLogExpansion(index);
                }
              } : undefined}
            >
              <span className={styles.expandIcon}>
                {hasExpandableContent ? (
                  isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                ) : (
                  <span style={{ width: '14px', display: 'inline-block' }}></span>
                )}
              </span>
              <span className={styles.logTimestamp}>{timestamp || ''}</span>
              <span className={styles.logDefault}> </span>
              <span className={styles.logDefault}>[</span>
              <span className={levelClass}>{level?.toUpperCase() || 'UNKNOWN'}</span>
              <span className={styles.logDefault}>]</span>
              {contextStr && (
                <>
                  <span className={styles.logDefault}> </span>
                  <span className={styles.logContext}>{contextStr}</span>
                </>
              )}
              <span className={styles.logDefault}> </span>
              <span className={styles.logMessage}>{message || ''}</span>
              {hasExpandableContent && (
                <span className={styles.expandHint}>
                  {isExpanded ? ' (click to collapse)' : ' (click to expand)'}
                </span>
              )}
            </div>
            {isExpanded && metaKeys.length > 0 && (
              <div className={styles.logMetadata}>
                <div className={styles.metadataHeader}>Metadata</div>
                <pre className={styles.logMetadataContent}>
                  {JSON.stringify(Object.fromEntries(metaKeys.map(k => [k, metadata[k]])), null, 2)}
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

      // Plain text log line - try to find log level in brackets
      const bracketMatch = line.match(/(\[)(info|warn|warning|error|err|debug)(\])/i);
      
      if (bracketMatch) {
        const matchIndex = bracketMatch.index;
        const beforeMatch = line.substring(0, matchIndex);
        const [, openBracket, levelText, closeBracket] = bracketMatch;
        const afterMatch = line.substring(matchIndex + bracketMatch[0].length);
        
        let levelClass = styles.logDefault;
        const lowerLevel = levelText.toLowerCase();
        if (lowerLevel === 'info') {
          levelClass = styles.logInfo;
        } else if (lowerLevel === 'warn' || lowerLevel === 'warning') {
          levelClass = styles.logWarn;
        } else if (lowerLevel === 'error' || lowerLevel === 'err') {
          levelClass = styles.logError;
        } else if (lowerLevel === 'debug') {
          levelClass = styles.logDebug;
        }
        
        return (
          <div key={index} className={styles.logEntry}>
            <div className={styles.logLine}>
              <span className={styles.expandIcon}>
                <span style={{ width: '14px', display: 'inline-block' }}></span>
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

      // Plain text line
      return (
        <div key={index} className={styles.logEntry}>
          <div className={styles.logLine}>
            <span className={styles.expandIcon}>
              <span style={{ width: '14px', display: 'inline-block' }}></span>
            </span>
            <span className={styles.logDefault}>{line}</span>
          </div>
        </div>
      );
    });
  }, [logs, expandedLogs]);

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
            <div className={styles.actions}>
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
                onClick={fetchLogs}
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
          {logs ? (
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


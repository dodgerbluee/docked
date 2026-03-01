/**
 * AppsHistoryTab
 * Displays run history for all app operations across all runners.
 * Mirrors the UpgradeHistoryTab pattern from the Containers page.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import PropTypes from "prop-types";
import axios from "axios";
import {
  History,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Filter,
  ArrowUpDown,
  Server,
} from "lucide-react";
import { API_BASE_URL } from "../../constants/api";
import LoadingSpinner from "../ui/LoadingSpinner";
import styles from "./AppsHistoryTab.module.css";

function formatDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDuration(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return null;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// Parse "appName:opName" from operationName field
function parseOpKey(operationName) {
  const idx = operationName.indexOf(":");
  if (idx === -1) return { appName: operationName, opName: "run" };
  return {
    appName: operationName.slice(0, idx),
    opName: operationName.slice(idx + 1),
  };
}

export default function AppsHistoryTab({ runners }) {
  const [historyByRunner, setHistoryByRunner] = useState({}); // runnerId → record[]
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("desc");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled(
      runners.map((r) =>
        axios
          .get(`${API_BASE_URL}/api/runners/${r.id}/apps/history?limit=100`)
          .then(({ data }) => ({ runnerId: r.id, records: data.history || [] }))
      )
    );
    const map = {};
    for (const result of results) {
      if (result.status === "fulfilled") {
        map[result.value.runnerId] = result.value.records;
      }
    }
    setHistoryByRunner(map);
    setLoading(false);
  }, [runners]);

  useEffect(() => {
    if (runners.length > 0) fetchAll();
    else setLoading(false);
  }, [fetchAll, runners.length]);

  const runnerById = useMemo(() => {
    const m = {};
    for (const r of runners) m[r.id] = r;
    return m;
  }, [runners]);

  // Flatten all records into one list, attach runner info
  const allRecords = useMemo(() => {
    return Object.entries(historyByRunner).flatMap(([runnerId, records]) => {
      const runner = runnerById[Number(runnerId)];
      return records.map((r) => ({ ...r, runner }));
    });
  }, [historyByRunner, runnerById]);

  const filtered = useMemo(() => {
    let list = [...allRecords];

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((r) => {
        const { appName, opName } = parseOpKey(r.operationName);
        return (
          appName.toLowerCase().includes(q) ||
          opName.toLowerCase().includes(q) ||
          r.runner?.name.toLowerCase().includes(q)
        );
      });
    }

    if (statusFilter === "success") {
      list = list.filter((r) => r.exitCode === 0);
    } else if (statusFilter === "failed") {
      list = list.filter((r) => r.exitCode !== 0 && r.exitCode != null);
    }

    list.sort((a, b) => {
      const ta = new Date(a.startedAt).getTime();
      const tb = new Date(b.startedAt).getTime();
      return sortOrder === "desc" ? tb - ta : ta - tb;
    });

    return list;
  }, [allRecords, search, statusFilter, sortOrder]);

  // Stats
  const stats = useMemo(() => {
    const finished = allRecords.filter((r) => r.exitCode != null);
    return {
      total: allRecords.length,
      success: finished.filter((r) => r.exitCode === 0).length,
      failed: finished.filter((r) => r.exitCode !== 0).length,
    };
  }, [allRecords]);

  if (loading) {
    return (
      <div className={styles.container}>
        <LoadingSpinner size="md" message="Loading history..." />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Stats bar */}
      {allRecords.length > 0 && (
        <div className={styles.statsBar}>
          <div className={styles.statCard}>
            <History size={20} className={styles.statIcon} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.total}</div>
              <div className={styles.statLabel}>Total Runs</div>
            </div>
          </div>
          <div className={styles.statCard}>
            <CheckCircle2 size={20} className={styles.statIconSuccess} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.success}</div>
              <div className={styles.statLabel}>Successful</div>
            </div>
          </div>
          {stats.failed > 0 && (
            <div className={styles.statCard}>
              <XCircle size={20} className={styles.statIconError} />
              <div className={styles.statContent}>
                <div className={styles.statValue}>{stats.failed}</div>
                <div className={styles.statLabel}>Failed</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className={styles.filtersBar}>
        <div className={styles.searchContainer}>
          <Search size={18} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search by app, operation, or runner…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        <div className={styles.filterGroup}>
          <Filter size={16} className={styles.filterIcon} />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={styles.filterSelect}
          >
            <option value="all">All Status</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <button
          className={styles.sortButton}
          onClick={() => setSortOrder((s) => (s === "desc" ? "asc" : "desc"))}
          title={sortOrder === "desc" ? "Sort Oldest First" : "Sort Newest First"}
        >
          <ArrowUpDown size={16} />
          {sortOrder === "desc" ? "Newest" : "Oldest"}
        </button>
      </div>

      {/* History list */}
      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <History size={36} style={{ opacity: 0.3 }} />
          <p>
            {allRecords.length === 0
              ? "No operations have been run yet."
              : "No runs match your filters."}
          </p>
        </div>
      ) : (
        <div className={styles.historyList}>
          {filtered.map((record) => {
            const { appName, opName } = parseOpKey(record.operationName);
            const success = record.exitCode === 0;
            const pending = record.exitCode == null;
            const duration = formatDuration(record.startedAt, record.finishedAt);

            return (
              <div
                key={`${record.runner?.id}-${record.id}`}
                className={`${styles.historyCard} ${
                  !pending && !success ? styles.historyCardFailed : ""
                }`}
              >
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {pending ? (
                      <Clock size={18} className={styles.pendingIcon} />
                    ) : success ? (
                      <CheckCircle2 size={18} className={styles.successIcon} />
                    ) : (
                      <XCircle size={18} className={styles.errorIcon} />
                    )}
                    <span className={styles.appName}>{appName}</span>
                    <span className={styles.opBadge}>{opName}</span>
                    {record.runner && (
                      <span className={styles.runnerBadge}>
                        <Server size={10} />
                        {record.runner.name}
                      </span>
                    )}
                  </div>
                  <div className={styles.cardMeta}>
                    <span className={styles.metaItem}>
                      <Clock size={12} />
                      {formatDate(record.startedAt)}
                    </span>
                    {duration && (
                      <span className={styles.metaItem}>{duration}</span>
                    )}
                    {!pending && (
                      <span
                        className={`${styles.exitBadge} ${
                          success ? styles.exitOk : styles.exitFail
                        }`}
                      >
                        exit {record.exitCode}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

AppsHistoryTab.propTypes = {
  runners: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number.isRequired,
      name: PropTypes.string.isRequired,
    })
  ).isRequired,
};

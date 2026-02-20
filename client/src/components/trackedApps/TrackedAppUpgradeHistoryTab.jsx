/**
 * TrackedAppUpgradeHistoryTab Component
 * Displays tracked app upgrade history with modern UI
 */

import React, { useState, useCallback, useMemo } from "react";
import {
  History,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  Search,
  Filter,
  ArrowUpDown,
  Github,
  Gitlab,
} from "lucide-react";
import { useTrackedAppUpgradeHistory } from "../../hooks/useTrackedAppUpgradeHistory";
import EmptyState from "../ui/EmptyState";
import LoadingSpinner from "../ui/LoadingSpinner";
import TrackedAppUpgradeHistoryDetailModal from "./TrackedAppUpgradeHistoryDetailModal";
import styles from "./TrackedAppUpgradeHistoryTab.module.css";

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
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function TrackedAppUpgradeHistoryTab() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("desc");
  const [selectedUpgrade, setSelectedUpgrade] = useState(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  const { history, loading, error, stats } = useTrackedAppUpgradeHistory();

  // Filter and sort history
  const filteredHistory = useMemo(() => {
    let filtered = [...history];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.app_name?.toLowerCase().includes(query) ||
          item.repository?.toLowerCase().includes(query) ||
          item.old_version?.toLowerCase().includes(query) ||
          item.new_version?.toLowerCase().includes(query)
      );
    }

    // Apply status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter((item) => item.status === statusFilter);
    }

    // Apply provider filter
    if (providerFilter !== "all") {
      filtered = filtered.filter((item) => item.provider === providerFilter);
    }

    // Sort by date
    filtered.sort((a, b) => {
      const dateA = new Date(a.created_at);
      const dateB = new Date(b.created_at);
      return sortOrder === "desc" ? dateB - dateA : dateA - dateB;
    });

    return filtered;
  }, [history, searchQuery, statusFilter, providerFilter, sortOrder]);

  const handleUpgradeClick = useCallback((upgrade) => {
    setSelectedUpgrade(upgrade);
    setIsDetailModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsDetailModalOpen(false);
    setSelectedUpgrade(null);
  }, []);

  if (loading) {
    return (
      <div className={styles.container}>
        <LoadingSpinner size="md" message="Loading upgrade history..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <EmptyState
          message={`Failed to load upgrade history: ${error}`}
          icon={XCircle}
          className={styles.emptyState}
        />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className={styles.container}>
        <EmptyState
          message="Tracked app upgrades will appear here once you start upgrading."
          icon={History}
          className={styles.emptyState}
        />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header with stats */}
      {stats && (
        <div className={styles.statsBar}>
          <div className={styles.statCard}>
            <History size={20} className={styles.statIcon} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.total_upgrades || 0}</div>
              <div className={styles.statLabel}>Total Upgrades</div>
            </div>
          </div>
          <div className={styles.statCard}>
            <CheckCircle2 size={20} className={styles.statIconSuccess} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.successful_upgrades || 0}</div>
              <div className={styles.statLabel}>Successful</div>
            </div>
          </div>
          {stats.failed_upgrades > 0 && (
            <div className={styles.statCard}>
              <XCircle size={20} className={styles.statIconError} />
              <div className={styles.statContent}>
                <div className={styles.statValue}>{stats.failed_upgrades || 0}</div>
                <div className={styles.statLabel}>Failed</div>
              </div>
            </div>
          )}
          {stats.avg_duration_ms && (
            <div className={styles.statCard}>
              <Clock size={20} className={styles.statIcon} />
              <div className={styles.statContent}>
                <div className={styles.statValue}>{formatDuration(stats.avg_duration_ms)}</div>
                <div className={styles.statLabel}>Avg Duration</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filters and search */}
      <div className={styles.filtersBar}>
        <div className={styles.searchContainer}>
          <Search size={18} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search by app name, repository, or version..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
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
        <div className={styles.filterGroup}>
          <Filter size={16} className={styles.filterIcon} />
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className={styles.filterSelect}
          >
            <option value="all">All Providers</option>
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
            <option value="docker">Docker</option>
          </select>
        </div>
        <button
          onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
          className={styles.sortButton}
          title={`Sort ${sortOrder === "desc" ? "oldest first" : "newest first"}`}
        >
          <ArrowUpDown size={16} />
          {sortOrder === "desc" ? "Newest" : "Oldest"}
        </button>
      </div>

      {/* Upgrade History List */}
      {filteredHistory.length === 0 ? (
        <EmptyState
          message="No upgrades match your search criteria"
          icon={Search}
          className={styles.emptyState}
        />
      ) : (
        <div className={styles.historyList}>
          {filteredHistory.map((upgrade) => (
            <div
              key={upgrade.id}
              className={`${styles.historyCard} ${
                upgrade.status === "failed" ? styles.failed : styles.success
              }`}
              onClick={() => handleUpgradeClick(upgrade)}
            >
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>
                  <div className={styles.providerIcon}>
                    {upgrade.provider === "github" ? <Github size={18} /> : <Gitlab size={18} />}
                  </div>
                  <h3 className={styles.appName}>{upgrade.app_name}</h3>
                  <div className={styles.statusBadge}>
                    {upgrade.status === "success" ? (
                      <CheckCircle2 size={16} className={styles.successIcon} />
                    ) : (
                      <XCircle size={16} className={styles.failedIcon} />
                    )}
                    {upgrade.status}
                  </div>
                </div>
                <ChevronRight size={20} className={styles.chevron} />
              </div>

              <div className={styles.cardBody}>
                <div className={styles.versionChange}>
                  <span className={styles.oldVersion}>{upgrade.old_version}</span>
                  <span className={styles.arrow}>→</span>
                  <span className={styles.newVersion}>{upgrade.new_version}</span>
                </div>

                <div className={styles.cardMeta}>
                  <div className={styles.metaItem}>
                    <Clock size={14} />
                    <span>{formatDate(upgrade.created_at)}</span>
                  </div>
                  {upgrade.upgrade_duration_ms && (
                    <div className={styles.metaItem}>
                      <Clock size={14} />
                      <span>{formatDuration(upgrade.upgrade_duration_ms)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedUpgrade && (
        <TrackedAppUpgradeHistoryDetailModal
          upgrade={selectedUpgrade}
          isOpen={isDetailModalOpen}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
}

export default TrackedAppUpgradeHistoryTab;

/**
 * UpgradeHistoryTab Component
 * Displays upgrade history with modern UI and clickable details
 */

import React, { useState, useCallback } from "react";
import {
  History,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  Search,
  Filter,
  ArrowUpDown,
} from "lucide-react";
import { useUpgradeHistory } from "../../hooks/useUpgradeHistory";
import EmptyState from "../ui/EmptyState";
import LoadingSpinner from "../ui/LoadingSpinner";
import UpgradeHistoryDetailModal from "./UpgradeHistoryDetailModal";
import styles from "./UpgradeHistoryTab.module.css";

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

function UpgradeHistoryTab() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("desc");
  const [selectedUpgrade, setSelectedUpgrade] = useState(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  const { history, loading, error, stats } = useUpgradeHistory({
    limit: 200,
  });

  // Filter and sort history
  const filteredHistory = React.useMemo(() => {
    let filtered = [...history];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.container_name?.toLowerCase().includes(query) ||
          item.old_image?.toLowerCase().includes(query) ||
          item.new_image?.toLowerCase().includes(query)
      );
    }

    // Apply status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter((item) => item.status === statusFilter);
    }

    // Sort by date
    filtered.sort((a, b) => {
      const dateA = new Date(a.created_at);
      const dateB = new Date(b.created_at);
      return sortOrder === "desc" ? dateB - dateA : dateA - dateB;
    });

    return filtered;
  }, [history, searchQuery, statusFilter, sortOrder]);

  const handleUpgradeClick = useCallback(async (upgrade) => {
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
            placeholder="Search by container or image name..."
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
        <button
          className={styles.sortButton}
          onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
          title={`Sort ${sortOrder === "desc" ? "Oldest First" : "Newest First"}`}
        >
          <ArrowUpDown size={16} />
          {sortOrder === "desc" ? "Newest" : "Oldest"}
        </button>
      </div>

      {/* History list */}
      {filteredHistory.length === 0 ? (
        <EmptyState
          message={
            searchQuery || statusFilter !== "all"
              ? "No upgrades match your filters!"
              : "No upgrade history yet! Upgrades will appear here once you upgrade containers."
          }
          icon={History}
          className={styles.emptyState}
        />
      ) : (
        <div className={styles.historyList}>
          {filteredHistory.map((upgrade) => (
            <div
              key={upgrade.id}
              className={`${styles.historyCard} ${
                upgrade.status === "failed" ? styles.historyCardFailed : ""
              }`}
              onClick={() => handleUpgradeClick(upgrade)}
            >
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>
                  {upgrade.status === "success" ? (
                    <CheckCircle2 size={20} className={styles.successIcon} />
                  ) : (
                    <XCircle size={20} className={styles.errorIcon} />
                  )}
                  <span className={styles.containerName}>{upgrade.container_name}</span>
                  {upgrade.portainer_instance_name && (
                    <span className={styles.instanceBadge}>{upgrade.portainer_instance_name}</span>
                  )}
                </div>
                <ChevronRight size={18} className={styles.chevronIcon} />
              </div>
              <div className={styles.cardBody}>
                <div className={styles.imageChange}>
                  <div className={styles.imageOld}>
                    <span className={styles.imageLabel}>From:</span>
                    <span className={styles.imageName}>{upgrade.old_image}</span>
                    {upgrade.old_version && (
                      <span className={styles.imageVersion}>{upgrade.old_version}</span>
                    )}
                  </div>
                  <div className={styles.arrow}>→</div>
                  <div className={styles.imageNew}>
                    <span className={styles.imageLabel}>To:</span>
                    <span className={styles.imageName}>{upgrade.new_image}</span>
                    {upgrade.new_version && (
                      <span className={styles.imageVersion}>{upgrade.new_version}</span>
                    )}
                  </div>
                </div>
                <div className={styles.cardMeta}>
                  <div className={styles.metaItem}>
                    <Clock size={14} />
                    <span>{formatDate(upgrade.created_at)}</span>
                  </div>
                  {upgrade.upgrade_duration_ms && (
                    <div className={styles.metaItem}>
                      <span>Duration: {formatDuration(upgrade.upgrade_duration_ms)}</span>
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
        <UpgradeHistoryDetailModal
          upgrade={selectedUpgrade}
          isOpen={isDetailModalOpen}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
}

UpgradeHistoryTab.propTypes = {};

export default UpgradeHistoryTab;

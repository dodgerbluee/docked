/**
 * Tracked Apps page header component
 */

import React, { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { RefreshCw, SlidersHorizontal, Search, X } from "lucide-react";
import Button from "../../../components/ui/Button";
import SearchInput from "../../../components/ui/SearchInput";
import styles from "../../TrackedAppsPage.module.css";

/**
 * Tracked Apps header component
 * @param {Object} props
 * @param {string} props.searchQuery - Search query value
 * @param {Function} props.onSearchChange - Search change handler
 * @param {Function} props.onCheckUpdates - Check for updates handler
 * @param {boolean} props.checkingUpdates - Whether checking for updates
 * @param {number} props.trackedAppsCount - Number of tracked images
 */
const TrackedAppsHeader = ({
  searchQuery,
  onSearchChange,
  onCheckUpdates,
  checkingUpdates,
  trackedAppsCount,
  mobileSidebarOpen,
  onMobileSidebarOpen,
}) => {
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  React.useEffect(() => {
    if (!mobileSearchOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setMobileSearchOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileSearchOpen]);

  const mobileRefreshTitle = useMemo(() => {
    return checkingUpdates ? "Checking for updates..." : "Check for updates";
  }, [checkingUpdates]);

  return (
    <div className={styles.summaryHeader}>
      <div className={styles.headerContent}>
        <h2 className={styles.summaryHeaderTitle}>
          <span className="sr-only">Apps</span>
        </h2>

        <div className={styles.headerLeft}>
          <div className={styles.desktopOnly}>
            <SearchInput
              value={searchQuery}
              onChange={onSearchChange}
              placeholder="Search apps..."
              className={styles.searchInput}
            />
          </div>
        </div>

        <div className={styles.headerActions}>
          <div className={styles.desktopActionGroup}>
            <div className={styles.buttonContainer}>
              <Button
                onClick={onCheckUpdates}
                disabled={checkingUpdates || trackedAppsCount === 0}
                title={mobileRefreshTitle}
                variant="outline"
                icon={RefreshCw}
                size="sm"
              >
                {checkingUpdates ? "Checking for Updates..." : "Check for Updates"}
              </Button>
            </div>
          </div>

          <div className={styles.mobileActionRow} aria-label="Tracked apps actions">
            <Button
              onClick={onMobileSidebarOpen}
              variant="outline"
              icon={SlidersHorizontal}
              size="sm"
              title="Filters"
              aria-label="Open filters"
              aria-controls="tracked-apps-filters-drawer"
              aria-expanded={mobileSidebarOpen ? "true" : "false"}
              className={styles.iconOnlyButton}
            >
              <span className="sr-only">Filters</span>
            </Button>

            <Button
              onClick={() => setMobileSearchOpen(true)}
              variant="outline"
              icon={Search}
              size="sm"
              title="Search"
              aria-label="Search apps"
              className={styles.iconOnlyButton}
            >
              <span className="sr-only">Search</span>
            </Button>

            <Button
              onClick={onCheckUpdates}
              disabled={checkingUpdates || trackedAppsCount === 0}
              title={mobileRefreshTitle}
              aria-label={mobileRefreshTitle}
              variant="outline"
              icon={RefreshCw}
              size="sm"
              className={styles.iconOnlyButton}
            >
              <span className="sr-only">Refresh</span>
            </Button>
          </div>
        </div>
      </div>

      {mobileSearchOpen && (
        <div className={styles.mobileSearchOverlay} role="dialog" aria-label="Search apps">
          <SearchInput
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Search apps..."
            className={styles.mobileSearchInput}
            autoFocus
          />
          <Button
            onClick={() => setMobileSearchOpen(false)}
            variant="outline"
            icon={X}
            size="sm"
            title="Close search"
            aria-label="Close search"
            className={styles.iconOnlyButton}
          >
            <span className="sr-only">Close</span>
          </Button>
        </div>
      )}
    </div>
  );
};

TrackedAppsHeader.propTypes = {
  searchQuery: PropTypes.string.isRequired,
  onSearchChange: PropTypes.func.isRequired,
  onCheckUpdates: PropTypes.func.isRequired,
  checkingUpdates: PropTypes.bool.isRequired,
  trackedAppsCount: PropTypes.number.isRequired,
  mobileSidebarOpen: PropTypes.bool,
  onMobileSidebarOpen: PropTypes.func,
};

export default TrackedAppsHeader;

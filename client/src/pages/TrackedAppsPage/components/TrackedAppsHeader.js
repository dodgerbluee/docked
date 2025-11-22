/**
 * Tracked Apps page header component
 */

import React from "react";
import PropTypes from "prop-types";
import { RefreshCw, Check } from "lucide-react";
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
 * @param {boolean} props.showCheckmark - Whether to show success checkmark
 * @param {number} props.trackedAppsCount - Number of tracked images
 * @param {boolean} props.markingUpgraded - Whether marking apps as upgraded
 * @param {React.ReactNode} props.toolbarActions - Toolbar action buttons
 */
const TrackedAppsHeader = ({
  searchQuery,
  onSearchChange,
  onCheckUpdates,
  checkingUpdates,
  showCheckmark,
  trackedAppsCount,
  markingUpgraded,
  toolbarActions,
}) => {
  return (
    <div className={styles.summaryHeader}>
      <div className={styles.headerContent}>
        <h2 className={styles.summaryHeaderTitle}>Tracked Apps</h2>
        <div className={styles.headerActions}>
          <SearchInput
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Search apps..."
            className={styles.searchInput}
          />
          <div className={styles.buttonContainer}>
            {toolbarActions}
            <Button
              onClick={onCheckUpdates}
              disabled={checkingUpdates || trackedAppsCount === 0 || markingUpgraded}
              title={checkingUpdates ? "Checking for updates..." : "Check for updates"}
              variant="outline"
              icon={RefreshCw}
              size="sm"
            >
              {checkingUpdates ? "Checking for Updates..." : "Check for Updates"}
            </Button>
            {showCheckmark && <Check className={styles.checkmark} size={20} />}
          </div>
        </div>
      </div>
    </div>
  );
};

TrackedAppsHeader.propTypes = {
  searchQuery: PropTypes.string.isRequired,
  onSearchChange: PropTypes.func.isRequired,
  onCheckUpdates: PropTypes.func.isRequired,
  checkingUpdates: PropTypes.bool.isRequired,
  showCheckmark: PropTypes.bool.isRequired,
  trackedAppsCount: PropTypes.number.isRequired,
  markingUpgraded: PropTypes.bool.isRequired,
  toolbarActions: PropTypes.node,
};

export default TrackedAppsHeader;

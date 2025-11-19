/**
 * Tracked Apps toolbar actions component
 */

import React from "react";
import PropTypes from "prop-types";
import Button from "../../../components/ui/Button";

/**
 * Tracked Apps toolbar actions component
 * @param {Object} props
 * @param {Array} props.appsWithUpdates - Apps with updates
 * @param {Set} props.selectedApps - Selected apps
 * @param {boolean} props.allAppsWithUpdatesSelected - Whether all apps with updates are selected
 * @param {boolean} props.markingUpgraded - Whether marking apps as upgraded
 * @param {Function} props.onSelectAll - Select all handler
 * @param {Function} props.onBatchMarkUpgraded - Batch mark upgraded handler
 */
const TrackedAppsToolbar = ({
  appsWithUpdates,
  selectedApps,
  allAppsWithUpdatesSelected,
  markingUpgraded,
  onSelectAll,
  onBatchMarkUpgraded,
}) => {
  if (appsWithUpdates.length === 0) {
    return null;
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={onSelectAll} disabled={markingUpgraded}>
        {allAppsWithUpdatesSelected ? "Deselect All" : "Select All"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onBatchMarkUpgraded}
        disabled={selectedApps.size === 0 || markingUpgraded}
      >
        {markingUpgraded
          ? `Marking Upgraded (${selectedApps.size})...`
          : `Mark Upgraded (${selectedApps.size})`}
      </Button>
    </>
  );
};

TrackedAppsToolbar.propTypes = {
  appsWithUpdates: PropTypes.array.isRequired,
  selectedApps: PropTypes.instanceOf(Set).isRequired,
  allAppsWithUpdatesSelected: PropTypes.bool.isRequired,
  markingUpgraded: PropTypes.bool.isRequired,
  onSelectAll: PropTypes.func.isRequired,
  onBatchMarkUpgraded: PropTypes.func.isRequired,
};

export default TrackedAppsToolbar;


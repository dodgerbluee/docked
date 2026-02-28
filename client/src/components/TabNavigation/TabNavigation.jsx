import React, { memo } from "react";
import { LayoutDashboard, MonitorSmartphone, BarChart3, Layers, Cpu } from "lucide-react";
import PropTypes from "prop-types";
import { containerShape } from "../../utils/propTypes";
import { TAB_NAMES } from "../../constants/apiConstants";
import "./TabNavigation.css";

/**
 * TabNavigation component
 * Displays main navigation tabs for the application
 */
const TabNavigation = ({
  activeTab,
  onTabChange,
  containersWithUpdates = [],
  trackedAppsBehind = 0,
  appsWithUpdates = 0,
}) => {
  return (
    <div className="tabs-container">
      <div className="tabs">
        <button
          className={`tab ${activeTab === TAB_NAMES.SUMMARY ? "active" : ""}`}
          onClick={() => onTabChange(TAB_NAMES.SUMMARY)}
          aria-label="Summary tab"
        >
          <LayoutDashboard size={18} />
          Summary
        </button>
        <button
          className={`tab ${activeTab === TAB_NAMES.PORTAINER ? "active" : ""}`}
          onClick={() => onTabChange(TAB_NAMES.PORTAINER)}
          aria-label="Containers tab"
        >
          <Layers size={18} />
          Containers
          {containersWithUpdates.length > 0 && (
            <span className="tab-badge">{containersWithUpdates.length}</span>
          )}
        </button>
        <button
          className={`tab ${activeTab === TAB_NAMES.APPS ? "active" : ""}`}
          onClick={() => onTabChange(TAB_NAMES.APPS)}
          aria-label={`Apps tab${appsWithUpdates > 0 ? `, ${appsWithUpdates} updates` : ""}`}
        >
          <Cpu size={18} />
          Apps
          {appsWithUpdates > 0 && (
            <span className="tab-badge">{appsWithUpdates}</span>
          )}
        </button>
        <button
          className={`tab ${activeTab === TAB_NAMES.TRACKED_APPS ? "active" : ""}`}
          onClick={() => onTabChange(TAB_NAMES.TRACKED_APPS)}
          aria-label="Repos tab"
        >
          <MonitorSmartphone size={18} />
          Repos
          {trackedAppsBehind > 0 && <span className="tab-badge">{trackedAppsBehind}</span>}
        </button>
        <button
          className={`tab ${activeTab === TAB_NAMES.ANALYTICS ? "active" : ""}`}
          onClick={() => onTabChange(TAB_NAMES.ANALYTICS)}
          aria-label="Analytics tab"
        >
          <BarChart3 size={18} />
          Analytics
        </button>
      </div>
    </div>
  );
};

TabNavigation.propTypes = {
  activeTab: PropTypes.string.isRequired,
  onTabChange: PropTypes.func.isRequired,
  containersWithUpdates: PropTypes.arrayOf(containerShape),
  trackedAppsBehind: PropTypes.number,
  appsWithUpdates: PropTypes.number,
};

export default memo(TabNavigation);

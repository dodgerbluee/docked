import React, { memo } from "react";
import { LayoutDashboard, MonitorSmartphone } from "lucide-react";
import PropTypes from "prop-types";
import { containerShape } from "../../utils/propTypes";
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
}) => {
  const handleSummaryClick = () => onTabChange("summary");
  const handlePortainerClick = () => onTabChange("portainer");
  const handleTrackedAppsClick = () => onTabChange("tracked-apps");

  return (
    <div className="tabs-container">
      <div className="tabs">
        <button
          className={`tab ${activeTab === "summary" ? "active" : ""}`}
          onClick={handleSummaryClick}
          aria-label="Summary tab"
        >
          <LayoutDashboard size={18} />
          Summary
        </button>
        <button
          className={`tab ${activeTab === "portainer" ? "active" : ""}`}
          onClick={handlePortainerClick}
          aria-label="Portainer tab"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="0"
            style={{ display: "inline-block", verticalAlign: "middle" }}
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M12.504 0v1.023l-.01-.015l-6.106 3.526H3.417v.751h5.359v3.638h1.942V5.284h1.786V15.7c.027 0 .54-.01.751.091V5.285h.531v10.608c.293.147.55.312.751.54V5.286h6.046v-.75h-1.267l-6.061-3.5V0zm0 1.87v2.664H7.889zm.751.031l4.56 2.633h-4.56zM9.142 5.285h1.21v1.686h-1.21zm-4.736 2.73v1.951h1.942v-1.95zm2.19 0v1.951h1.941v-1.95zm-2.19 2.171v1.951h1.942v-1.95zm2.19 0v1.951h1.941v-1.95zm2.18 0v1.951h1.942v-1.95zM4.36 12.43a3.73 3.73 0 0 0-.494 1.851c0 1.227.604 2.308 1.52 2.986c.239-.064.477-.1.724-.11c.1 0 .165.01.266.019c.284-1.191 1.383-1.988 2.665-1.988c.724 0 1.438.201 1.924.668c.229-.476.302-1.007.302-1.575c0-.65-.165-1.292-.494-1.85zm4.828 3.16c-1.21 0-2.226.844-2.492 1.97a1 1 0 0 0-.275-.009a2.56 2.56 0 0 0-2.564 2.556a2.565 2.565 0 0 0 3.096 2.5A2.58 2.58 0 0 0 9.233 24c.862 0 1.622-.43 2.09-1.081a2.557 2.557 0 0 0 4.186-1.97c0-.567-.193-1.099-.504-1.52a2.557 2.557 0 0 0-3.866-2.94a2.57 2.57 0 0 0-1.951-.898z"
            />
          </svg>
          Portainer
          {containersWithUpdates.length > 0 && (
            <span className="tab-badge">{containersWithUpdates.length}</span>
          )}
        </button>
        <button
          className={`tab ${activeTab === "tracked-apps" ? "active" : ""}`}
          onClick={handleTrackedAppsClick}
          aria-label="Tracked Apps tab"
        >
          <MonitorSmartphone size={18} />
          Tracked Apps
          {trackedAppsBehind > 0 && <span className="tab-badge">{trackedAppsBehind}</span>}
        </button>
      </div>
    </div>
  );
};

TabNavigation.propTypes = {
  activeTab: PropTypes.oneOf(["summary", "portainer", "tracked-apps"]).isRequired,
  onTabChange: PropTypes.func.isRequired,
  containersWithUpdates: PropTypes.arrayOf(containerShape),
  trackedAppsBehind: PropTypes.number,
};

export default memo(TabNavigation);

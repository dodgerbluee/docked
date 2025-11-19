import React from "react";
import PropTypes from "prop-types";
import TabNavigation from "../ui/TabNavigation";
import { ADMIN_TABS, ADMIN_TAB_LABELS } from "../../constants/admin";

/**
 * AdminTabNavigation Component
 * Renders the tab navigation buttons for the Admin page
 * Uses the reusable TabNavigation component for consistency
 */
const AdminTabNavigation = React.memo(function AdminTabNavigation({ activeTab, onTabChange }) {
  const tabs = [
    ADMIN_TABS.GENERAL,
    ADMIN_TABS.USERS,
    ADMIN_TABS.LOGS,
  ];

  return (
    <TabNavigation
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={onTabChange}
      labels={ADMIN_TAB_LABELS}
    />
  );
});

AdminTabNavigation.propTypes = {
  activeTab: PropTypes.string.isRequired,
  onTabChange: PropTypes.func.isRequired,
};

export default AdminTabNavigation;


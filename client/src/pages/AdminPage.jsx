import React, { useState } from "react";
import LogsTab from "../components/settings/LogsTab";
import UsersTab from "../components/admin/UsersTab";
import AdminGeneralTab from "../components/admin/AdminGeneralTab";
import SSOTab from "../components/admin/SSOTab";
import AdminTabNavigation from "../components/admin/AdminTabNavigation";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import { ADMIN_TABS } from "../constants/admin";
import { useAdminGeneralSettings } from "../hooks/useAdminGeneralSettings";
import styles from "./AdminPage.module.css";

/**
 * AdminPage Component
 * Admin-only page containing logs and other administrative features
 */
function AdminPage() {
  const [activeTab, setActiveTab] = useState(ADMIN_TABS.GENERAL);
  const adminSettings = useAdminGeneralSettings();

  const renderTabContent = () => {
    switch (activeTab) {
      case ADMIN_TABS.GENERAL:
        return !adminSettings.isInitialized ? (
          <LoadingSpinner size="md" message="Loading settings..." />
        ) : (
          <AdminGeneralTab
            localLogLevel={adminSettings.localLogLevel}
            handleLogLevelChange={adminSettings.handleLogLevelChange}
            generalSettingsChanged={adminSettings.generalSettingsChanged}
            generalSettingsSaving={adminSettings.generalSettingsSaving}
            generalSettingsSuccess={adminSettings.generalSettingsSuccess}
            handleSaveGeneralSettings={adminSettings.handleSaveGeneralSettings}
          />
        );
      case ADMIN_TABS.USERS:
        return <UsersTab />;
      case ADMIN_TABS.SSO:
        return <SSOTab />;
      case ADMIN_TABS.LOGS:
        return <LogsTab />;
      default:
        return <LogsTab />;
    }
  };

  return (
    <div className={styles.adminPage}>
      <div className={styles.summaryHeader}>
        <div className={styles.headerContent}>
          <h2 className={styles.adminHeader}>Admin</h2>
        </div>
      </div>

      {/* Tab Navigation */}
      <AdminTabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab Content */}
      <div className={styles.contentTabPanel}>{renderTabContent()}</div>
    </div>
  );
}

export default AdminPage;

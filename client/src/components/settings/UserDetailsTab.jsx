import React, { useState } from "react";
import PropTypes from "prop-types";
import { Download } from "lucide-react";
import { useExport } from "../../hooks/useExport";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import styles from "./UserDetailsTab.module.css";
import generalStyles from "./GeneralTab.module.css";
import UserInfoCard from "./UserDetailsTab/components/UserInfoCard";
import UsernameSection from "./UserDetailsTab/components/UsernameSection";
import PasswordSection from "./UserDetailsTab/components/PasswordSection";
import AvatarSection from "./UserDetailsTab/components/AvatarSection";

/**
 * UserDetailsTab Component
 * Merged user management tab with collapsible sections for Username, Password, and Avatar
 */
const UserDetailsTab = React.memo(function UserDetailsTab({
  userInfo,
  // Username props
  newUsername,
  setNewUsername,
  usernamePassword,
  setUsernamePassword,
  usernameError,
  usernameSuccess,
  usernameLoading,
  handleUsernameSubmit,
  // Password props
  currentPassword,
  setCurrentPassword,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  passwordError,
  passwordSuccess,
  passwordLoading,
  handlePasswordSubmit,
  // Avatar props
  avatar,
  recentAvatars = [],
  onAvatarChange,
  onRecentAvatarsChange,
  onAvatarUploaded,
}) {
  // Use reusable export hook
  const { exporting, exportError, exportSuccess, handleExport } = useExport();

  // Collapsible sections state
  const [expandedSections, setExpandedSections] = useState({
    username: false,
    password: false,
    avatar: false,
  });

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleExportConfig = () => {
    handleExport(
      "/api/user/export-config",
      "docked-config-export",
      "Configuration exported successfully!"
    );
  };

  return (
    <div className={styles.updateSection}>
      <h3 className={styles.title}>User Settings</h3>

      {/* User Information Section */}
      <UserInfoCard userInfo={userInfo} />

      {/* Username Section */}
      <UsernameSection
        isExpanded={expandedSections.username}
        onToggle={() => toggleSection("username")}
        newUsername={newUsername}
        setNewUsername={setNewUsername}
        usernamePassword={usernamePassword}
        setUsernamePassword={setUsernamePassword}
        usernameError={usernameError}
        usernameSuccess={usernameSuccess}
        usernameLoading={usernameLoading}
        handleUsernameSubmit={handleUsernameSubmit}
      />

      {/* Password Section */}
      <PasswordSection
        isExpanded={expandedSections.password}
        onToggle={() => toggleSection("password")}
        currentPassword={currentPassword}
        setCurrentPassword={setCurrentPassword}
        newPassword={newPassword}
        setNewPassword={setNewPassword}
        confirmPassword={confirmPassword}
        setConfirmPassword={setConfirmPassword}
        passwordError={passwordError}
        passwordSuccess={passwordSuccess}
        passwordLoading={passwordLoading}
        handlePasswordSubmit={handlePasswordSubmit}
      />

      {/* Avatar Section */}
      <AvatarSection
        isExpanded={expandedSections.avatar}
        onToggle={() => toggleSection("avatar")}
        avatar={avatar}
        recentAvatars={recentAvatars}
        onAvatarChange={onAvatarChange}
        onRecentAvatarsChange={onRecentAvatarsChange}
        onAvatarUploaded={onAvatarUploaded}
      />

      {/* Configuration Management Section */}
      <div className={`${generalStyles.dataManagement} ${styles.exportContainer}`}>
        <h4 className={generalStyles.sectionTitle}>Configuration Management</h4>
        {exportSuccess && <Alert variant="info">{exportSuccess}</Alert>}
        {exportError && <Alert variant="error">{exportError}</Alert>}
        <div className={generalStyles.dataActions}>
          <div className={generalStyles.dataActionItem}>
            <div className={styles.exportButtonContainer}>
              <Button
                type="button"
                variant="primary"
                onClick={handleExportConfig}
                disabled={exporting}
                icon={Download}
                className={generalStyles.saveButton}
              >
                {exporting ? "Exporting..." : "Export Configuration"}
              </Button>
            </div>
            <small className={`${generalStyles.dataActionHelper} ${styles.exportHelperText}`}>
              Export all your database configurations including Portainer instances, Docker Hub
              credentials, Discord webhooks, tracked images, and general settings in JSON format.
            </small>
          </div>
        </div>
      </div>
    </div>
  );
});

UserDetailsTab.propTypes = {
  userInfo: PropTypes.object,
  // Username props
  newUsername: PropTypes.string.isRequired,
  setNewUsername: PropTypes.func.isRequired,
  usernamePassword: PropTypes.string.isRequired,
  setUsernamePassword: PropTypes.func.isRequired,
  usernameError: PropTypes.string,
  usernameSuccess: PropTypes.string,
  usernameLoading: PropTypes.bool.isRequired,
  handleUsernameSubmit: PropTypes.func.isRequired,
  // Password props
  currentPassword: PropTypes.string.isRequired,
  setCurrentPassword: PropTypes.func.isRequired,
  newPassword: PropTypes.string.isRequired,
  setNewPassword: PropTypes.func.isRequired,
  confirmPassword: PropTypes.string.isRequired,
  setConfirmPassword: PropTypes.func.isRequired,
  passwordError: PropTypes.string,
  passwordSuccess: PropTypes.string,
  passwordLoading: PropTypes.bool.isRequired,
  handlePasswordSubmit: PropTypes.func.isRequired,
  // Avatar props
  avatar: PropTypes.string,
  recentAvatars: PropTypes.arrayOf(PropTypes.string),
  onAvatarChange: PropTypes.func.isRequired,
  onRecentAvatarsChange: PropTypes.func,
  onAvatarUploaded: PropTypes.func,
};

export default UserDetailsTab;

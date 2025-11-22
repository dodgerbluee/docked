import React, { memo } from "react";
import { Bell } from "lucide-react";
import PropTypes from "prop-types";
import AvatarMenu from "./AvatarMenu";
import NotificationMenu from "./NotificationMenu";
import { containerShape, trackedAppShape } from "../../utils/propTypes";
import styles from "./Header.module.css";

/**
 * Header component for the application
 * Contains logo, notifications, and user avatar menu
 */
const Header = ({
  username,
  userRole,
  avatar,
  darkMode,
  notificationCount,
  activeContainersWithUpdates = [],
  activeTrackedAppsBehind = [],
  discordWebhooks = [],
  showNotificationMenu,
  showAvatarMenu,
  instanceAdmin,
  onToggleNotificationMenu,
  onToggleAvatarMenu,
  onNavigateToSummary,
  onNavigateToSettings,
  onNavigateToBatch,
  onNavigateToAdmin,
  onNavigateToPortainer,
  onNavigateToTrackedApps,
  onDismissContainerNotification,
  onDismissTrackedAppNotification,
  onTemporaryThemeToggle,
  onLogout,
  API_BASE_URL,
}) => {
  const handleLogoClick = () => {
    onNavigateToSummary();
  };

  const handleNotificationToggle = (e) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent event from bubbling to click-outside handler
    if (typeof onToggleNotificationMenu === "function") {
      // If menu is open, close it; otherwise open it
      if (showNotificationMenu) {
        onToggleNotificationMenu(false);
      } else {
        onToggleNotificationMenu(true);
      }
    }
  };

  const handleNotificationClose = () => {
    if (typeof onToggleNotificationMenu === "function") {
      onToggleNotificationMenu(false);
    }
  };

  return (
    <header className={styles.header}>
      <div className={styles.headerContent}>
        <div
          onClick={handleLogoClick}
          className={styles.logoContainer}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleLogoClick();
            }
          }}
          aria-label="Navigate to Summary"
        >
          <h1 className={styles.logo}>
            <img src="/img/logo.png" alt="Docked" className={styles.logoImage} />
            <img src="/img/text-header.png" alt="docked" className={styles.logoTextImage} />
          </h1>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.actionsContainer}>
            <div className={styles.notificationWrapper}>
              <button
                className={`${styles.notificationButton} notification-button`}
                onClick={handleNotificationToggle}
                aria-label="Notifications"
                title="Notifications"
              >
                <Bell size={25} className={styles.notificationIcon} />
                {notificationCount > 0 && (
                  <span className={styles.notificationBadge}>
                    {notificationCount > 99 ? "99+" : notificationCount}
                  </span>
                )}
              </button>
              {showNotificationMenu && (
                <NotificationMenu
                  notificationCount={notificationCount}
                  activeContainersWithUpdates={activeContainersWithUpdates}
                  activeTrackedAppsBehind={activeTrackedAppsBehind}
                  discordWebhooks={discordWebhooks}
                  onClose={handleNotificationClose}
                  onNavigateToPortainer={onNavigateToPortainer}
                  onNavigateToTrackedApps={onNavigateToTrackedApps}
                  onNavigateToSummary={onNavigateToSummary}
                  onDismissContainerNotification={onDismissContainerNotification}
                  onDismissTrackedAppNotification={onDismissTrackedAppNotification}
                />
              )}
            </div>
            <AvatarMenu
              username={username}
              userRole={userRole}
              avatar={avatar}
              darkMode={darkMode}
              showAvatarMenu={showAvatarMenu}
              instanceAdmin={instanceAdmin}
              onToggleAvatarMenu={onToggleAvatarMenu}
              onNavigateToSummary={onNavigateToSummary}
              onNavigateToSettings={onNavigateToSettings}
              onNavigateToBatch={onNavigateToBatch}
              onNavigateToAdmin={onNavigateToAdmin}
              onTemporaryThemeToggle={onTemporaryThemeToggle}
              onLogout={onLogout}
              API_BASE_URL={API_BASE_URL}
            />
          </div>
        </div>
      </div>
    </header>
  );
};

Header.propTypes = {
  username: PropTypes.string,
  userRole: PropTypes.string,
  avatar: PropTypes.string.isRequired,
  darkMode: PropTypes.bool.isRequired,
  notificationCount: PropTypes.number.isRequired,
  activeContainersWithUpdates: PropTypes.arrayOf(containerShape),
  activeTrackedAppsBehind: PropTypes.arrayOf(trackedAppShape),
  discordWebhooks: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      avatarUrl: PropTypes.string,
      name: PropTypes.string,
      serverName: PropTypes.string,
      enabled: PropTypes.bool,
    })
  ),
  showNotificationMenu: PropTypes.bool.isRequired,
  showAvatarMenu: PropTypes.bool.isRequired,
  instanceAdmin: PropTypes.bool,
  onToggleNotificationMenu: PropTypes.func.isRequired,
  onToggleAvatarMenu: PropTypes.func.isRequired,
  onNavigateToSummary: PropTypes.func.isRequired,
  onNavigateToSettings: PropTypes.func.isRequired,
  onNavigateToBatch: PropTypes.func.isRequired,
  onNavigateToAdmin: PropTypes.func,
  onNavigateToPortainer: PropTypes.func.isRequired,
  onNavigateToTrackedApps: PropTypes.func.isRequired,
  onDismissContainerNotification: PropTypes.func.isRequired,
  onDismissTrackedAppNotification: PropTypes.func.isRequired,
  onTemporaryThemeToggle: PropTypes.func.isRequired,
  onLogout: PropTypes.func.isRequired,
  API_BASE_URL: PropTypes.string.isRequired,
};

export default memo(Header);

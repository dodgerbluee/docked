import React, { memo } from "react";
import PropTypes from "prop-types";
import AvatarMenu from "./AvatarMenu";
import styles from "./Header.module.css";

/**
 * Header component for the application
 * Contains logo and user avatar menu
 */
const Header = ({
  username,
  userRole,
  avatar,
  darkMode,
  showAvatarMenu,
  instanceAdmin,
  onToggleAvatarMenu,
  onNavigateToSummary,
  onNavigateToSettings,
  onNavigateToBatch,
  onNavigateToAdmin,
  onTemporaryThemeToggle,
  onLogout,
  API_BASE_URL,
}) => {
  const handleLogoClick = () => {
    onNavigateToSummary();
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
  showAvatarMenu: PropTypes.bool.isRequired,
  instanceAdmin: PropTypes.bool,
  onToggleAvatarMenu: PropTypes.func.isRequired,
  onNavigateToSummary: PropTypes.func.isRequired,
  onNavigateToSettings: PropTypes.func,
  onNavigateToBatch: PropTypes.func.isRequired,
  onNavigateToAdmin: PropTypes.func,
  onTemporaryThemeToggle: PropTypes.func.isRequired,
  onLogout: PropTypes.func.isRequired,
  API_BASE_URL: PropTypes.string.isRequired,
};

export default memo(Header);

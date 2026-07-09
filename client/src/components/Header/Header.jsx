import React, { memo } from "react";
import PropTypes from "prop-types";
import { WifiOff } from "lucide-react";
import AvatarMenu from "./AvatarMenu";
import styles from "./Header.module.css";

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
  offlineRunners = [],
}) => {
  const handleLogoClick = () => {
    onNavigateToSummary();
  };

  const offlineCount = offlineRunners.length;
  const offlineLabel =
    offlineCount === 1
      ? `"${offlineRunners[0].name}" is offline`
      : `${offlineCount} runners offline`;

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
            {offlineCount > 0 && (
              <button
                className={styles.runnerAlert}
                onClick={onNavigateToSettings}
                title={offlineLabel}
                aria-label={offlineLabel}
              >
                <span className={styles.runnerAlertDot} />
                <WifiOff size={14} />
                <span className={styles.runnerAlertText}>{offlineLabel}</span>
              </button>
            )}
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
  offlineRunners: PropTypes.array,
};

export default memo(Header);

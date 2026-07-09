import React, { memo, useState, useRef, useEffect } from "react";
import PropTypes from "prop-types";
import { AlertTriangle, WifiOff } from "lucide-react";
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
  const [showAlertMenu, setShowAlertMenu] = useState(false);
  const alertRef = useRef(null);

  useEffect(() => {
    if (!showAlertMenu) return;
    const handler = (e) => {
      if (alertRef.current && !alertRef.current.contains(e.target)) {
        setShowAlertMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAlertMenu]);

  const offlineCount = offlineRunners.length;

  return (
    <header className={styles.header}>
      <div className={styles.headerContent}>
        <div
          onClick={onNavigateToSummary}
          className={styles.logoContainer}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onNavigateToSummary();
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
              <div className={styles.alertContainer} ref={alertRef}>
                <button
                  className={styles.alertBtn}
                  onClick={() => setShowAlertMenu((v) => !v)}
                  aria-label={`${offlineCount} alert${offlineCount !== 1 ? "s" : ""}`}
                  title={`${offlineCount} alert${offlineCount !== 1 ? "s" : ""}`}
                >
                  <AlertTriangle size={18} />
                </button>
                {showAlertMenu && (
                  <div className={styles.alertDropdown}>
                    <div className={styles.alertDropdownHeader}>Alerts</div>
                    {offlineRunners.map((runner) => (
                      <button
                        key={runner.id ?? runner.name}
                        className={styles.alertItem}
                        onClick={() => {
                          setShowAlertMenu(false);
                          onNavigateToSettings();
                        }}
                      >
                        <WifiOff size={14} className={styles.alertItemIcon} />
                        <span className={styles.alertItemName}>{runner.name}</span>
                        <span className={styles.alertItemBadge}>Offline</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
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

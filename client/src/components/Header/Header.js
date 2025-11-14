import React from "react";
import { Bell } from "lucide-react";
import AvatarMenu from "./AvatarMenu";
import NotificationMenu from "./NotificationMenu";
import "./Header.css";

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
  showNotificationMenu,
  showAvatarMenu,
  onToggleNotificationMenu,
  onToggleAvatarMenu,
  onNavigateToSummary,
  onNavigateToSettings,
  onNavigateToBatch,
  onNavigateToPortainer,
  onNavigateToTrackedApps,
  onDismissContainerNotification,
  onDismissTrackedAppNotification,
  onTemporaryThemeToggle,
  onLogout,
  API_BASE_URL,
}) => {
  return (
    <header className="App-header">
      <div className="header-content">
        <div
          onClick={() => {
            onNavigateToSummary();
          }}
          style={{
            cursor: "pointer",
            transition: "opacity 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "0.8";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "1";
          }}
        >
          <h1>
            <img
              src="/img/image.png"
              alt="Docked"
              style={{
                height: "2em",
                verticalAlign: "middle",
                marginRight: "8px",
                display: "inline-block",
              }}
            />
            <span
              style={{
                display: "inline-block",
                transform: "translateY(3px)",
              }}
            >
              Docked
            </span>
          </h1>
        </div>
        <div className="header-actions">
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <div style={{ position: "relative", marginRight: "18px" }}>
              <button
                className="notification-button"
                onClick={() => {
                  if (typeof onToggleNotificationMenu === 'function') {
                    onToggleNotificationMenu(!showNotificationMenu);
                  }
                }}
                aria-label="Notifications"
                title="Notifications"
                style={{
                  padding: "0",
                  background: "transparent",
                  color: "white",
                  border: "none",
                  borderRadius: "0",
                  cursor: "pointer",
                  transition: "all 0.3s",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "auto",
                  height: "auto",
                  position: "relative",
                }}
                onMouseEnter={(e) => {
                  e.target.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = "translateY(0)";
                }}
              >
                <Bell
                  size={25}
                  style={{ display: "block", transform: "translateY(0.5px)" }}
                />
                {notificationCount > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: "-4px",
                      right: "-4px",
                      background: "var(--dodger-red)",
                      color: "white",
                      borderRadius: "50%",
                      width: "16px",
                      height: "16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.65rem",
                      fontWeight: "bold",
                      border: "2px solid white",
                      zIndex: 10,
                      pointerEvents: "none",
                    }}
                  >
                    {notificationCount > 99 ? "99+" : notificationCount}
                  </span>
                )}
              </button>
              {showNotificationMenu && (
                <NotificationMenu
                  notificationCount={notificationCount}
                  activeContainersWithUpdates={activeContainersWithUpdates}
                  activeTrackedAppsBehind={activeTrackedAppsBehind}
                  onClose={() => {
                    if (typeof onToggleNotificationMenu === 'function') {
                      onToggleNotificationMenu(false);
                    }
                  }}
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
              onToggleAvatarMenu={onToggleAvatarMenu}
              onNavigateToSummary={onNavigateToSummary}
              onNavigateToSettings={onNavigateToSettings}
              onNavigateToBatch={onNavigateToBatch}
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

export default Header;


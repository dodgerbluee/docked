import React, { memo } from "react";
import PropTypes from "prop-types";
import { Home, FileText, Settings, Sun, Moon, LogOut, Shield } from "lucide-react";
import "./AvatarMenu.css";

/**
 * AvatarMenu component
 * Displays user avatar and dropdown menu with navigation options
 */
const AvatarMenu = ({
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
  return (
    <div className="avatar-menu-container">
      <button
        className="avatar-button"
        onClick={() => {
          if (typeof onToggleAvatarMenu === "function") {
            onToggleAvatarMenu(!showAvatarMenu);
          }
        }}
        aria-label="User Menu"
        title="User Menu"
      >
        {avatar ? (
          <img
            src={
              avatar.startsWith("blob:") || avatar.startsWith("http") || avatar.startsWith("/img/")
                ? avatar
                : `${API_BASE_URL}${avatar}`
            }
            alt="User Avatar"
            className="avatar-image"
            onError={(e) => {
              if (e.target.src !== "/img/default-avatar.jpg") {
                e.target.src = "/img/default-avatar.jpg";
              }
            }}
          />
        ) : (
          <div className="avatar-image avatar-loading" />
        )}
      </button>
      {username && (
        <div
          data-username-role
          onClick={() => {
            if (typeof onToggleAvatarMenu === "function") {
              onToggleAvatarMenu(!showAvatarMenu);
            }
          }}
          className="username-role-container"
        >
          <span className="username-text">{username}</span>
          <span className="user-role-text">{userRole}</span>
        </div>
      )}
      {showAvatarMenu && (
        <div className="avatar-menu">
          <div className="avatar-menu-actions">
            <button
              className="avatar-menu-item"
              onClick={() => {
                onNavigateToSummary();
                onToggleAvatarMenu(false);
              }}
            >
              <Home size={16} />
              Home
            </button>
            <button
              className="avatar-menu-item"
              onClick={() => {
                onNavigateToBatch();
                onToggleAvatarMenu(false);
              }}
            >
              <FileText size={16} />
              Batch
            </button>
            <button
              className="avatar-menu-item"
              onClick={() => {
                onNavigateToSettings();
                onToggleAvatarMenu(false);
              }}
            >
              <Settings size={16} />
              Settings
            </button>
            <button
              className="avatar-menu-item"
              onClick={() => {
                onTemporaryThemeToggle();
              }}
            >
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
              {darkMode ? "Light Mode" : "Dark Mode"}
            </button>
            {instanceAdmin && (
              <button
                className="avatar-menu-item"
                onClick={() => {
                  onNavigateToAdmin();
                  onToggleAvatarMenu(false);
                }}
              >
                <Shield size={16} />
                Admin
              </button>
            )}
            <div className="avatar-menu-divider"></div>
            <button
              className="avatar-menu-item"
              onClick={() => {
                onLogout();
                onToggleAvatarMenu(false);
              }}
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

AvatarMenu.propTypes = {
  username: PropTypes.string,
  userRole: PropTypes.string,
  avatar: PropTypes.string, // Can be null while loading
  darkMode: PropTypes.bool.isRequired,
  showAvatarMenu: PropTypes.bool.isRequired,
  instanceAdmin: PropTypes.bool,
  onToggleAvatarMenu: PropTypes.func.isRequired,
  onNavigateToSummary: PropTypes.func.isRequired,
  onNavigateToSettings: PropTypes.func.isRequired,
  onNavigateToBatch: PropTypes.func.isRequired,
  onNavigateToAdmin: PropTypes.func,
  onTemporaryThemeToggle: PropTypes.func.isRequired,
  onLogout: PropTypes.func.isRequired,
  API_BASE_URL: PropTypes.string.isRequired,
};

export default memo(AvatarMenu);

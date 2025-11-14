import React from "react";
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
  onToggleAvatarMenu,
  onNavigateToSummary,
  onNavigateToSettings,
  onNavigateToBatch,
  onTemporaryThemeToggle,
  onLogout,
  API_BASE_URL,
}) => {
  return (
    <div className="avatar-menu-container">
      <button
        className="avatar-button"
        onClick={() => {
          if (typeof onToggleAvatarMenu === 'function') {
            onToggleAvatarMenu(!showAvatarMenu);
          }
        }}
        aria-label="User Menu"
        title="User Menu"
      >
        <img
          key={avatar}
          src={
            avatar.startsWith("blob:") ||
            avatar.startsWith("http") ||
            avatar.startsWith("/img/")
              ? avatar
              : `${API_BASE_URL}${avatar}`
          }
          alt="User Avatar"
          className="avatar-image"
          onError={(e) => {
            e.target.src = "/img/default-avatar.jpg";
          }}
        />
      </button>
      {username && (
        <div
          data-username-role
          onClick={() => {
            if (typeof onToggleAvatarMenu === 'function') {
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
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              Home
            </button>
            <button
              className="avatar-menu-item"
              onClick={() => {
                onNavigateToBatch();
                onToggleAvatarMenu(false);
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              Batch
            </button>
            <button
              className="avatar-menu-item"
              onClick={() => {
                onNavigateToSettings();
                onToggleAvatarMenu(false);
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Settings
            </button>
            <button
              className="avatar-menu-item"
              onClick={() => {
                onTemporaryThemeToggle();
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {darkMode ? (
                  <>
                    <circle cx="12" cy="12" r="5" />
                    <line x1="12" y1="1" x2="12" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="23" />
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                    <line x1="1" y1="12" x2="3" y2="12" />
                    <line x1="21" y1="12" x2="23" y2="12" />
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                  </>
                ) : (
                  <>
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </>
                )}
              </svg>
              {darkMode ? "Light Mode" : "Dark Mode"}
            </button>
            <div className="avatar-menu-divider"></div>
            <button
              className="avatar-menu-item"
              onClick={() => {
                onLogout();
                onToggleAvatarMenu(false);
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AvatarMenu;


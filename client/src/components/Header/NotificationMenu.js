import React from "react";
import "./NotificationMenu.css";

/**
 * NotificationMenu component
 * Displays container and tracked app update notifications
 */
const NotificationMenu = ({
  notificationCount,
  activeContainersWithUpdates,
  activeTrackedAppsBehind,
  onClose,
  onNavigateToPortainer,
  onNavigateToTrackedApps,
  onNavigateToSummary,
  onDismissContainerNotification,
  onDismissTrackedAppNotification,
}) => {
  return (
    <div className="notification-menu">
      <div className="notification-menu-header">
        <h3>Notifications</h3>
        {notificationCount > 0 && (
          <span className="notification-count-badge">{notificationCount}</span>
        )}
      </div>
      <div className="notification-menu-content">
        {activeContainersWithUpdates.length > 0 && (
          <>
            <div className="notification-section-header">
              Container Updates ({activeContainersWithUpdates.length})
            </div>
            {activeContainersWithUpdates.slice(0, 5).map((container) => (
              <div key={container.id} className="notification-item">
                <div
                  className="notification-item-content"
                  onClick={() => {
                    onClose();
                    onNavigateToPortainer && onNavigateToPortainer(container);
                  }}
                >
                  <div className="notification-item-title">{container.name}</div>
                  <div className="notification-item-subtitle">
                    Update available
                  </div>
                </div>
                <button
                  className="notification-dismiss-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const latestVersion =
                      container.latestVersion ||
                      container.newVersion ||
                      container.latestTag ||
                      container.latestDigest;
                    onDismissContainerNotification(container.id, latestVersion);
                  }}
                  aria-label="Dismiss notification"
                  title="Dismiss"
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
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
            {activeContainersWithUpdates.length > 5 && (
              <div
                className="notification-view-all"
                onClick={() => {
                  onClose();
                  onNavigateToSummary();
                }}
              >
                View all {activeContainersWithUpdates.length} container updates
              </div>
            )}
          </>
        )}
        {activeTrackedAppsBehind.length > 0 && (
          <>
            {activeContainersWithUpdates.length > 0 && (
              <div className="notification-divider" />
            )}
            <div className="notification-section-header">
              Tracked App Updates ({activeTrackedAppsBehind.length})
            </div>
            {activeTrackedAppsBehind.slice(0, 5).map((image) => (
              <div key={image.id} className="notification-item">
                <div
                  className="notification-item-content"
                  onClick={() => {
                    onClose();
                    onNavigateToTrackedApps();
                  }}
                >
                  <div className="notification-item-title">{image.name}</div>
                  <div className="notification-item-subtitle">
                    Update available: {image.latest_version}
                  </div>
                </div>
                <button
                  className="notification-dismiss-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismissTrackedAppNotification(image.id, image.latest_version);
                  }}
                  aria-label="Dismiss notification"
                  title="Dismiss"
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
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
            {activeTrackedAppsBehind.length > 5 && (
              <div
                className="notification-view-all"
                onClick={() => {
                  onClose();
                  onNavigateToTrackedApps();
                }}
              >
                View all {activeTrackedAppsBehind.length} tracked app updates
              </div>
            )}
          </>
        )}
        {notificationCount === 0 && (
          <div className="notification-empty">No new notifications</div>
        )}
      </div>
    </div>
  );
};

export default NotificationMenu;


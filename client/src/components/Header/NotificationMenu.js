import React, { memo } from "react";
import PropTypes from "prop-types";
import { X, Bell } from "lucide-react";
import { containerShape, trackedImageShape } from "../../utils/propTypes";
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
                  <div className="notification-item-subtitle">Update available</div>
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
                  <X size={16} />
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
            {activeContainersWithUpdates.length > 0 && <div className="notification-divider" />}
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
                  <X size={16} />
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
          <div className="notification-empty">
            <Bell size={24} className="notification-empty-icon" />
            <span>No new notifications</span>
          </div>
        )}
      </div>
    </div>
  );
};

NotificationMenu.propTypes = {
  notificationCount: PropTypes.number.isRequired,
  activeContainersWithUpdates: PropTypes.arrayOf(containerShape),
  activeTrackedAppsBehind: PropTypes.arrayOf(trackedImageShape),
  onClose: PropTypes.func.isRequired,
  onNavigateToPortainer: PropTypes.func.isRequired,
  onNavigateToTrackedApps: PropTypes.func.isRequired,
  onNavigateToSummary: PropTypes.func.isRequired,
  onDismissContainerNotification: PropTypes.func.isRequired,
  onDismissTrackedAppNotification: PropTypes.func.isRequired,
};

export default memo(NotificationMenu);
